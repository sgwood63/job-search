/**
 * Job Search MCP Sidecar
 *
 * Self-contained MCP server — no separate OB1 MCP server required.
 * Shares the same PostgreSQL database (js_* + thoughts tables) and MinIO object store.
 * Provides 35 MCP tools: 32 job-search tools + 3 OB1-compat tools (search, fetch, thought_stats)
 * absorbed from the OB1 MCP server, plus a REST API at /api/v2/* and /ob1/rest/* for webapp access.
 *
 * Environment variables:
 *   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD   PostgreSQL (same cluster as OB1)
 *   EMBEDDING_API_BASE, EMBEDDING_API_KEY, EMBEDDING_MODEL   for thought capture
 *   CHAT_API_BASE, CHAT_API_KEY, CHAT_MODEL   for metadata extraction
 *   OBJECT_STORE_BACKEND   'minio' (default) or 'supabase'
 *   MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_BUCKET   (if using Supabase storage)
 *   MCP_ACCESS_KEY   authentication key for this server
 *   CITATION_BASE_URL   base URL for thought citation links (default: http://localhost/job-search/thoughts)
 *   PORT   HTTP port (default: 8001)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { Pool } from "postgres";
import { traceGeneration, traceSpan } from "./langfuse_ts.ts";
import {
  registerJobSearchTools,
  listThoughtsCore,
  chunkMarkdown,
  uploadFileCore, getFileCore, getFileUrlCore, listFilesCore, deleteFileCore, deleteApplicationCore,
  getPipelineCore, getApplicationCore, getProfilesCore, deleteProfileCore, upsertProfileCore, getOverdueFollowupsCore,
  createApplicationCore, updateApplicationStatusCore, logInterviewCore, completeInterviewCore,
  addContactCore, upsertCompanyCore, searchApplicationsSemanticCore, searchChunksSemanticCore,
  updateApplicationFieldsCore, findSimilarApplicationsCore, getIngestionHistoryCore,
  logSearchRunCore, updateSearchRunCore, logIngestedPositionCore, getSearchRunsCore,
  type ChunkContentFn, type EmbedQueryFn, type LogSearchRunArgs, type UpdateSearchRunArgs, type LogIngestedPositionArgs,
  type UpsertProfileArgs,
} from "./job-search-tools.ts";

// --- Configuration ---

const DB_HOST = Deno.env.get("DB_HOST") || "127.0.0.1";
const DB_PORT = parseInt(Deno.env.get("DB_PORT") || "5432", 10);
const DB_NAME = Deno.env.get("DB_NAME") || "openbrain";
const DB_USER = Deno.env.get("DB_USER") || "postgres";
const DB_PASSWORD = Deno.env.get("DB_PASSWORD")!;

const EMBEDDING_API_BASE = Deno.env.get("EMBEDDING_API_BASE") || "https://openrouter.ai/api/v1";
const EMBEDDING_API_KEY = Deno.env.get("EMBEDDING_API_KEY") || Deno.env.get("LLM_API_KEY") || "";
const EMBEDDING_MODEL = Deno.env.get("EMBEDDING_MODEL") || "openai/text-embedding-3-small";

const CHAT_API_BASE = Deno.env.get("CHAT_API_BASE") || EMBEDDING_API_BASE;
const CHAT_API_KEY = Deno.env.get("CHAT_API_KEY") || EMBEDDING_API_KEY;
const CHAT_MODEL = Deno.env.get("CHAT_MODEL") || "openai/gpt-4o-mini";

const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

// --- PostgreSQL Pool ---

const pool = new Pool({
  hostname: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
}, 10);

// --- Embedding + Metadata (mirrors OB1 index.ts) ---

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${EMBEDDING_API_BASE}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${EMBEDDING_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`Embedding API failed: ${r.status} ${msg}`);
  }
  const d = await r.json();
  traceGeneration({
    name: "embedding",
    model: EMBEDDING_MODEL,
    input: text.slice(0, 200),
    usage: { input: d.usage?.prompt_tokens ?? 0, output: 0 },
    tags: ["service:job-search-mcp"],
  }).catch(() => {});
  return d.data[0].embedding;
}

const MAX_EMBED_CHARS = 25_000;

async function summarizeForEmbedding(content: string): Promise<string> {
  const r = await fetch(`${CHAT_API_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CHAT_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        {
          role: "system",
          content: "Summarize this document in 3-5 sentences for semantic search indexing. Focus on what it contains and why someone would search for it.",
        },
        { role: "user", content: content.slice(0, 80_000) },
      ],
    }),
  });
  const d = await r.json();
  const summary = d.choices[0].message.content as string;
  traceGeneration({
    name: "summarize-for-embedding",
    model: CHAT_MODEL,
    input: content.slice(0, 200),
    output: summary.slice(0, 200),
    usage: {
      input: d.usage?.prompt_tokens ?? 0,
      output: d.usage?.completion_tokens ?? 0,
    },
    tags: ["service:job-search-mcp"],
  }).catch(() => {});
  return summary;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${CHAT_API_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CHAT_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.`,
        },
        { role: "user", content: text },
      ],
    }),
  });
  const d = await r.json();
  let extracted: Record<string, unknown>;
  try {
    extracted = JSON.parse(d.choices[0].message.content);
  } catch {
    extracted = { topics: ["uncategorized"], type: "observation" };
  }
  traceGeneration({
    name: "extract-metadata",
    model: CHAT_MODEL,
    input: text.slice(0, 200),
    output: JSON.stringify(extracted).slice(0, 200),
    usage: {
      input: d.usage?.prompt_tokens ?? 0,
      output: d.usage?.completion_tokens ?? 0,
    },
    tags: ["service:job-search-mcp"],
  }).catch(() => {});
  return extracted;
}

// --- captureThought: writes into OB1's thoughts table, tagged with source ---

async function captureThought(
  content: string,
  metadata: Record<string, unknown>,
): Promise<string> {
  const large = content.length > MAX_EMBED_CHARS;
  const embedText = large ? await summarizeForEmbedding(content) : content;
  const [embedding, extracted] = await Promise.all([
    getEmbedding(embedText),
    extractMetadata(embedText),
  ]);
  const meta = { ...extracted, ...metadata, source: "job-search-mcp", ...(large && { summarized: true }) };
  const embStr = `[${embedding.join(",")}]`;
  const client = await pool.connect();
  try {
    const existing = await client.queryObject<{ id: string }>(
      `SELECT id::text AS id FROM thoughts WHERE content = $1 LIMIT 1`, [content],
    );
    if (existing.rows[0]) {
      await client.queryObject(
        `UPDATE thoughts SET embedding = $1::vector, metadata = $2::jsonb WHERE id = $3`,
        [embStr, JSON.stringify(meta), existing.rows[0].id],
      );
      return existing.rows[0].id;
    }
    const result = await client.queryObject<{ id: string }>(
      `INSERT INTO thoughts (content, embedding, metadata)
       VALUES ($1, $2::vector, $3::jsonb) RETURNING id::text AS id`,
      [content, embStr, JSON.stringify(meta)],
    );
    return result.rows[0].id;
  } finally {
    client.release();
  }
}

// --- searchThoughts: semantic search scoped to job-search content ---

async function searchThoughts(
  query: string,
  limit: number,
  filter: Record<string, unknown>,
): Promise<Array<{ id: string; content: string; metadata: Record<string, unknown>; similarity: number; created_at: string }>> {
  const qEmb = await getEmbedding(query);
  const embStr = `[${qEmb.join(",")}]`;

  const extraClauses: string[] = [];
  const params: unknown[] = [embStr, 0.4, limit];
  let pIdx = 4;

  if (filter.source) {
    extraClauses.push(`metadata->>'source' = $${pIdx++}`);
    params.push(filter.source);
  }

  const whereExtra = extraClauses.length ? ` AND ${extraClauses.join(" AND ")}` : "";

  const client = await pool.connect();
  try {
    const result = await client.queryObject<{
      id: string; content: string; metadata: Record<string, unknown>; similarity: number; created_at: string;
    }>(
      `SELECT id::text AS id, content, metadata, created_at,
              1 - (embedding <=> $1::vector) AS similarity
       FROM thoughts
       WHERE 1 - (embedding <=> $1::vector) >= $2${whereExtra}
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      params,
    );
    return result.rows;
  } finally {
    client.release();
  }
}

// --- listThoughts: list from OB1's thoughts table with optional filters ---

async function listThoughts(
  limit: number,
  type?: string,
  topic?: string,
  person?: string,
  days?: number,
): Promise<Array<{ id: string; content: string; metadata: Record<string, unknown>; created_at: string }>> {
  return listThoughtsCore(pool, limit, type, topic, person, days);
}

// --- embedQuery: thin wrapper so getEmbedding satisfies EmbedQueryFn ---

const embedQuery: EmbedQueryFn = (query: string): Promise<number[]> => getEmbedding(query);

// --- chunkContent: H2-section chunking + per-chunk embedding (Phase 2) ---

const chunkContent: ChunkContentFn = async (content: string, storageKey: string): Promise<void> => {
  const chunks = chunkMarkdown(content);
  if (chunks.length === 0) return;

  const client = await pool.connect();
  try {
    // Idempotent: remove stale chunks and their orphaned thought rows before re-inserting
    await client.queryObject(`
      DELETE FROM thoughts WHERE id IN (
        SELECT thought_id FROM js_chunks WHERE storage_key = $1 AND thought_id IS NOT NULL
      )`, [storageKey]);
    await client.queryObject(`DELETE FROM js_chunks WHERE storage_key = $1`, [storageKey]);

    // Resolve file_id (js_files row was already upserted by uploadFileCore before this call)
    const { rows: fileRows } = await client.queryObject(
      `SELECT id FROM js_files WHERE storage_key = $1`, [storageKey],
    );
    const fileId: string | null = (fileRows[0] as any)?.id ?? null;

    for (const chunk of chunks) {
      let thoughtId: string | null = null;
      try {
        thoughtId = await captureThought(chunk.content, {
          type: "file-chunk",
          storage_key: storageKey,
          section_title: chunk.title,
          section_index: chunk.index,
        });
      } catch { /* best-effort: chunk still stored without embedding */ }

      await client.queryObject(
        `INSERT INTO js_chunks (storage_key, file_id, section_title, section_index, content, char_count, thought_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [storageKey, fileId, chunk.title, chunk.index, chunk.content, chunk.content.length, thoughtId],
      );
    }
  } finally {
    client.release();
  }
};

// --- MCP Server ---

const server = new McpServer({
  name: "job-search",
  version: "1.0.0",
});

registerJobSearchTools(server, pool, { captureThought, searchThoughts, listThoughts, embedQuery, chunkContent });

// --- Hono App ---

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id, mcp-protocol-version, last-event-id",
};

const JSON_RPC_UNAUTHORIZED_CODE = -32001;
const UNAUTHORIZED_MESSAGE = "Unauthorized: missing or invalid authentication.";

function extractJsonRpcId(bodyText: string | null): string | number | null {
  if (!bodyText) return null;
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed && typeof parsed === "object" && "id" in parsed) {
      const id = (parsed as { id: unknown }).id;
      if (typeof id === "string" || typeof id === "number" || id === null) return id;
    }
  } catch { /* fall through */ }
  return null;
}

const app = new Hono();

// CORS preflight — no auth required
app.options("*", (c) => c.text("ok", 200, corsHeaders));

// Auth middleware — applies to all non-OPTIONS requests
app.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") return await next();

  const provided = c.req.header("x-brain-key") ?? new URL(c.req.url).searchParams.get("key");
  if (provided && provided === MCP_ACCESS_KEY) return await next();

  // REST routes: plain 401 JSON
  if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/ob1/rest/")) {
    return c.json({ error: UNAUTHORIZED_MESSAGE }, 401, corsHeaders);
  }

  // MCP protocol: return JSON-RPC 2.0 error envelope at HTTP 200 (MCP clients treat 4xx as transport failure)
  const bodyText = c.req.method !== "GET" ? await c.req.text().catch(() => null) : null;
  const id = extractJsonRpcId(bodyText);
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    error: { code: JSON_RPC_UNAUTHORIZED_CODE, message: UNAUTHORIZED_MESSAGE },
    id,
  }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
});

// Timing middleware — REST routes only (MCP timing handled inline in the catch-all)
app.use("/api/*", async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  const status = c.res?.status ?? 0;
  traceSpan({
    name: `rest:${c.req.method} ${c.req.path}`,
    tags: ["service:job-search-mcp", `method:${c.req.method}`, `status:${status}`],
    metadata: { method: c.req.method, path: c.req.path, status, duration_ms: ms },
    durationMs: ms,
    level: status >= 400 ? "ERROR" : "DEFAULT",
    statusMessage: status >= 400 ? String(status) : undefined,
  }).catch(() => {});
});

// ===========================================================================
// REST API — /api/v2/*
// ===========================================================================

// --- File routes ---

app.put("/api/v2/files/*", async (c) => {
  const key = c.req.path.slice("/api/v2/files/".length);
  const body = await c.req.json();
  const thoughtCategory = c.req.query("thought_category");
  const start = Date.now();
  const result = await uploadFileCore(pool, captureThought, {
    key,
    content: body.content,
    content_type: body.content_type ?? "text/markdown",
    binary: body.binary ?? false,
    ...(thoughtCategory ? { thought_category: thoughtCategory } : {}),
    ...(body.application_folder ? { application_folder: body.application_folder } : {}),
  }, chunkContent);
  traceSpan({
    name: "file-upload",
    tags: ["service:job-search-mcp"],
    metadata: {
      key,
      content_type: body.content_type ?? "text/markdown",
      binary: body.binary ?? false,
      bytes: result.bytes,
      duration_ms: Date.now() - start,
    },
    durationMs: Date.now() - start,
  }).catch(() => {});
  return c.json(result, 201, corsHeaders);
});

// List must come before the wildcard GET to avoid ambiguity
app.get("/api/v2/files", async (c) => {
  const prefix = c.req.query("prefix") ?? "";
  const files = await listFilesCore(pool, prefix);
  return c.json(files, 200, corsHeaders);
});

app.get("/api/v2/files/*", async (c) => {
  const key = c.req.path.slice("/api/v2/files/".length);
  const start = Date.now();
  const { bytes, contentType } = await getFileCore(key);
  traceSpan({
    name: "file-get",
    tags: ["service:job-search-mcp"],
    metadata: { key, content_type: contentType, bytes: bytes.length, duration_ms: Date.now() - start },
    durationMs: Date.now() - start,
  }).catch(() => {});
  return new Response(bytes, {
    headers: { "Content-Type": contentType, ...corsHeaders },
  });
});

app.delete("/api/v2/files/*", async (c) => {
  const key = c.req.path.slice("/api/v2/files/".length);
  const result = await deleteFileCore(pool, key);
  return c.json(result, 200, corsHeaders);
});

app.get("/api/v2/file-url/*", async (c) => {
  const key = c.req.path.slice("/api/v2/file-url/".length);
  const expiresIn = parseInt(c.req.query("expires_in") ?? "3600", 10);
  const result = await getFileUrlCore(key, expiresIn);
  return c.json(result, 200, corsHeaders);
});

// --- Application routes ---

app.post("/api/v2/applications", async (c) => {
  const body = await c.req.json();
  const result = await createApplicationCore(pool, {
    company_name: body.company_name,
    role_title: body.role_title,
    folder_prefix: body.folder_prefix,
    profile_slug: body.profile_slug,
    source_url: body.source_url,
    status: body.status ?? "resume-ready",
    priority: body.priority ?? 1,
    status_detail: body.status_detail,
  });
  return c.json(result, 201, corsHeaders);
});

app.get("/api/v2/applications/:id", async (c) => {
  const id = c.req.param("id");
  const results = await getApplicationCore(pool, id);
  const result = results[0];
  if (!result) return c.json({ error: "Not found" }, 404, corsHeaders);
  return c.json(result, 200, corsHeaders);
});

app.patch("/api/v2/applications/:id/status", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const result = await updateApplicationStatusCore(pool, {
    id,
    status: body.status,
    status_detail: body.status_detail,
    follow_up_date: body.follow_up_date,
    applied_date: body.applied_date,
  });
  if (!result) return c.json({ error: "Not found" }, 404, corsHeaders);
  return c.json(result, 200, corsHeaders);
});

app.delete("/api/v2/applications", async (c) => {
  const { folder_prefix } = await c.req.json();
  const result = await deleteApplicationCore(pool, folder_prefix);
  if (!result) return c.json({ error: "Not found" }, 404, corsHeaders);
  return c.json(result, 200, corsHeaders);
});

app.post("/api/v2/applications/:id/interviews", async (c) => {
  const application_id = c.req.param("id");
  const body = await c.req.json();
  const result = await logInterviewCore(pool, {
    application_id,
    stage: body.stage,
    scheduled_at: body.scheduled_at,
    interviewer_name: body.interviewer_name,
    interviewer_title: body.interviewer_title,
    pre_notes: body.pre_notes,
  });
  return c.json(result, 201, corsHeaders);
});

// --- Interview routes ---

app.patch("/api/v2/interviews/:id/complete", async (c) => {
  const interview_id = c.req.param("id");
  const body = await c.req.json();
  const result = await completeInterviewCore(pool, {
    interview_id,
    post_notes: body.post_notes,
    rating: body.rating,
  });
  if (!result) return c.json({ error: "Not found" }, 404, corsHeaders);
  return c.json(result, 200, corsHeaders);
});

// --- Contact routes ---

app.post("/api/v2/contacts", async (c) => {
  const body = await c.req.json();
  const result = await addContactCore(pool, {
    name: body.name,
    company_name: body.company_name,
    title: body.title,
    email: body.email,
    linkedin_url: body.linkedin_url,
    relationship_type: body.relationship_type ?? "network",
    notes: body.notes,
  });
  return c.json(result, 201, corsHeaders);
});

// --- Company routes ---

app.put("/api/v2/companies/:slug", async (c) => {
  const slug = c.req.param("slug");
  const body = await c.req.json();
  const result = await upsertCompanyCore(pool, {
    name: body.name,
    slug,
    industry: body.industry,
    size_range: body.size_range,
    remote_policy: body.remote_policy,
    website: body.website,
    domain_tags: body.domain_tags,
    notes: body.notes,
  });
  return c.json(result, 200, corsHeaders);
});

// --- Contacts read route ---

app.get("/api/v2/contacts", async (c) => {
  const company = c.req.query("company");
  const client = await pool.connect();
  try {
    const { rows } = await client.queryObject(
      `SELECT ct.id::text AS id, ct.name, ct.title, ct.email, ct.linkedin_url,
              ct.relationship_type, ct.notes, ct.last_contact_at, ct.follow_up_date,
              COALESCE(c.name, '') AS company_name
       FROM js_contacts ct
       LEFT JOIN js_companies c ON ct.company_id = c.id
       ${company ? "WHERE LOWER(c.name) LIKE LOWER($1)" : ""}
       ORDER BY ct.last_contact_at DESC NULLS LAST`,
      company ? [`%${company}%`] : [],
    );
    return c.json(rows, 200, corsHeaders);
  } finally { client.release(); }
});

// --- Read routes (used by webapp to avoid direct Postgres access) ---

app.get("/api/v2/tracker", async (c) => {
  const q = c.req.query();
  const rows = await getPipelineCore(pool, {
    status: q.status || undefined,
    statuses: q.statuses ? q.statuses.split(",") : undefined,
    company: q.company || undefined,
    role: q.role || undefined,
    profile: q.profile || undefined,
    priority: q.priority ? parseInt(q.priority, 10) : undefined,
    min_priority: q.min_priority ? parseInt(q.min_priority, 10) : undefined,
    due_before: q.due_before || undefined,
    limit: q.limit ? parseInt(q.limit, 10) : 50,
  });
  return c.json(rows, 200, corsHeaders);
});

app.get("/api/v2/profiles", async (c) => {
  const rows = await getProfilesCore(pool);
  return c.json(rows, 200, corsHeaders);
});

app.post("/api/v2/profiles", async (c) => {
  const body = await c.req.json() as UpsertProfileArgs;
  if (!body.slug || !body.display_name) {
    return c.json({ error: "slug and display_name are required" }, 400, corsHeaders);
  }
  const result = await upsertProfileCore(pool, body);
  return c.json(result, 200, corsHeaders);
});

app.delete("/api/v2/profiles/:id", async (c) => {
  const id = c.req.param("id");
  const deleted = await deleteProfileCore(pool, id);
  if (!deleted) return c.json({ error: "Not found" }, 404, corsHeaders);
  return c.json({ deleted: true }, 200, corsHeaders);
});

app.get("/api/v2/overdue", async (c) => {
  const rows = await getOverdueFollowupsCore(pool);
  return c.json(rows, 200, corsHeaders);
});

// --- Semantic search ---

app.post("/api/v2/search", async (c) => {
  const { query, limit = 5 } = await c.req.json();
  const start = Date.now();
  const results = await searchApplicationsSemanticCore(searchThoughts, query, limit);
  if (results === null) return c.json({ error: "Search not configured" }, 503, corsHeaders);
  traceSpan({
    name: "search-applications-semantic",
    tags: ["service:job-search-mcp"],
    metadata: { query: query.slice(0, 200), limit, result_count: results.length, duration_ms: Date.now() - start },
    durationMs: Date.now() - start,
  }).catch(() => {});
  return c.json(results, 200, corsHeaders);
});

// Phase 2: section-level chunk search
app.post("/api/v2/search/chunks", async (c) => {
  const { query, storage_key_prefix, limit = 5 } = await c.req.json();
  const start = Date.now();
  const results = await searchChunksSemanticCore(pool, embedQuery, { query, storage_key_prefix, limit });
  if (results === null) return c.json({ error: "Chunk search not configured" }, 503, corsHeaders);
  traceSpan({
    name: "search-chunks-semantic",
    tags: ["service:job-search-mcp"],
    metadata: {
      query: query.slice(0, 200),
      storage_key_prefix: storage_key_prefix ?? null,
      limit,
      result_count: results.length,
      duration_ms: Date.now() - start,
    },
    durationMs: Date.now() - start,
  }).catch(() => {});
  return c.json(results, 200, corsHeaders);
});

// Phase 3: structured metadata
app.patch("/api/v2/applications/:id/fields", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const result = await updateApplicationFieldsCore(pool, {
    id,
    domain_connection: body.domain_connection,
    domain_tags: body.domain_tags,
    jd_requirements: body.jd_requirements,
  });
  if (!result) return c.json({ error: "Not found or no fields to update" }, 404, corsHeaders);
  return c.json(result, 200, corsHeaders);
});

// Phase 3: cross-app pattern matching
app.post("/api/v2/search/similar-applications", async (c) => {
  const { query, exclude_id, limit = 5 } = await c.req.json();
  const results = await findSimilarApplicationsCore(pool, embedQuery, { query, exclude_id, limit });
  if (results === null) return c.json({ error: "Similar application search not configured" }, 503, corsHeaders);
  return c.json(results, 200, corsHeaders);
});

// Ingestion history (dedup audit trail)
app.get("/api/v2/ingestion/history", async (c) => {
  const profile_slug = c.req.query("profile_slug") || undefined;
  const outcome = c.req.query("outcome") || undefined;
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);
  const direct_only = c.req.query("direct_only") === "true";
  const rows = await getIngestionHistoryCore(pool, { profile_slug, outcome, limit, direct_only });
  return c.json(rows, 200, corsHeaders);
});

// --- Search run routes ---

app.get("/api/v2/search-runs", async (c) => {
  const profile_slug = c.req.query("profile_slug") || undefined;
  const since = c.req.query("since") || undefined;
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 200);
  const rows = await getSearchRunsCore(pool, { profile_slug, since, limit });
  return c.json(rows, 200, corsHeaders);
});

app.post("/api/v2/search-runs", async (c) => {
  const body = await c.req.json() as LogSearchRunArgs;
  const id = await logSearchRunCore(pool, body);
  traceSpan({
    name: "ingest-run",
    tags: ["service:job-search-mcp", `profile:${body.profile_slug ?? "unknown"}`],
    metadata: {
      profile_slug: body.profile_slug,
      run_type: body.run_type,
      query_used: body.query_used?.slice(0, 200),
      total_fetched: body.total_fetched,
      fit_count: body.fit_count,
      no_fit_count: body.no_fit_count,
      error_count: body.error_count,
      fetch_failed_count: body.fetch_failed_count,
    },
  }).catch(() => {});
  return c.json({ id }, 201, corsHeaders);
});

app.patch("/api/v2/search-runs/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json() as Omit<UpdateSearchRunArgs, "id">;
  await updateSearchRunCore(pool, { id, ...body });
  return c.json({ id, updated: true }, 200, corsHeaders);
});

app.post("/api/v2/ingested-positions", async (c) => {
  const sessionId = c.req.header("x-langfuse-session-id");
  const body = await c.req.json() as LogIngestedPositionArgs;
  const result = await logIngestedPositionCore(pool, body);
  traceSpan({
    name: "job-screened",
    tags: ["service:job-search", `outcome:${body.outcome}`],
    metadata: {
      company: body.company_name,
      role: body.role_title,
      outcome: body.outcome,
      no_fit_reason: body.no_fit_reason ?? null,
      profile_slug: body.profile_slug ?? null,
      search_run_id: body.search_run_id ?? null,
      is_repost: body.is_repost ?? false,
    },
    sessionId: sessionId || undefined,
  }).catch(() => {});
  return c.json(result, 201, corsHeaders);
});

// ===========================================================================
// OB1 REST API — /ob1/rest/* (absorbed from ob1-rest-pg service)
// Previously served by the ob1-rest-pg Deployment on port 8002. Rewritten
// from npm:postgres@3 tagged-template syntax to use this server's Pool.
// ===========================================================================

app.use("/ob1/rest/*", async (c, next) => {
  if (c.req.method === "OPTIONS") return await next();
  const sessionId = c.req.header("x-langfuse-session-id") ?? undefined;
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  const status = c.res?.status ?? 0;
  traceSpan({
    name: `rest:${c.req.method} ${c.req.path}`,
    tags: ["service:ob1-rest", `method:${c.req.method}`, `status:${status}`],
    metadata: { method: c.req.method, path: c.req.path, status, duration_ms: ms },
    durationMs: ms,
    level: status >= 400 ? "ERROR" : "DEFAULT",
    statusMessage: status >= 400 ? String(status) : undefined,
    sessionId,
  }).catch(() => {});
});

type OB1Row = { id: string; content: string; metadata: Record<string, unknown> | null; created_at: string };

function ob1Norm(row: OB1Row, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const meta = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
  const sv = (v: unknown) => typeof v === "string" && (v as string).trim() ? v as string : null;
  const nv = (v: unknown, d: number) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
  return {
    id: String(row.id), uuid: String(row.id),
    content: row.content,
    type: sv(meta.type) ?? "observation",
    source_type: sv(meta.source) ?? sv(meta.source_type) ?? "unknown",
    importance: nv(meta.importance, 50), quality_score: nv(meta.quality_score, 50),
    sensitivity_tier: sv(meta.sensitivity_tier) ?? "standard",
    metadata: meta,
    created_at: row.created_at,
    updated_at: sv(meta.updated_at) ?? row.created_at,
    status: sv(meta.status),
    status_updated_at: sv(meta.status_updated_at),
    ...extra,
  };
}

function ob1Fp(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s]/g, "").trim();
}

function ob1TokenSim(a: string, b: string): number {
  const at = new Set(a.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const bt = new Set(b.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  if (!at.size || !bt.size) return 0;
  let inter = 0; for (const t of at) if (bt.has(t)) inter++;
  return inter / new Set([...at, ...bt]).size;
}

function ob1Pi(v: string | null | undefined, d: number, min = 0, max = 100000): number {
  const x = parseInt(v ?? "", 10);
  return Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : d;
}

async function ob1CaptureThought(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const content = String(body.content ?? "").trim();
  if (!content) throw Object.assign(new Error("content is required"), { status: 400 });

  const type = String(body.type ?? "observation");
  const srcType = String(body.source_type ?? "dashboard");
  const status = body.status !== undefined ? body.status
    : (["task", "idea"].includes(type) ? "new" : null);
  const meta: Record<string, unknown> = {
    type, source: srcType, source_type: srcType,
    importance: body.importance ?? 50, quality_score: body.quality_score ?? 70,
    sensitivity_tier: body.sensitivity_tier ?? "standard",
    ...(typeof body.metadata === "object" && body.metadata !== null
      ? body.metadata as Record<string, unknown> : {}),
    status, status_updated_at: status ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const client = await pool.connect();
  try {
    const { rows: existRows } = await client.queryObject<{ id: string }>(
      `SELECT id::text AS id FROM thoughts WHERE content = $1 LIMIT 1`,
      [content],
    );
    const existing = existRows[0];
    let thoughtId: string;
    let action: string;

    try {
      const emb = await getEmbedding(content);
      const embStr = `[${emb.join(",")}]`;
      if (existing) {
        await client.queryObject(
          `UPDATE thoughts SET embedding=$1::vector, metadata=$2::jsonb WHERE id=$3`,
          [embStr, JSON.stringify(meta), existing.id],
        );
        thoughtId = existing.id; action = "updated";
      } else {
        const { rows } = await client.queryObject<{ id: string }>(
          `INSERT INTO thoughts (content, embedding, metadata) VALUES ($1, $2::vector, $3::jsonb) RETURNING id::text AS id`,
          [content, embStr, JSON.stringify(meta)],
        );
        thoughtId = rows[0].id; action = "created";
      }
    } catch {
      if (existing) {
        await client.queryObject(
          `UPDATE thoughts SET metadata=$1::jsonb WHERE id=$2`,
          [JSON.stringify(meta), existing.id],
        );
        thoughtId = existing.id; action = "updated";
      } else {
        const { rows } = await client.queryObject<{ id: string }>(
          `INSERT INTO thoughts (content, metadata) VALUES ($1, $2::jsonb) RETURNING id::text AS id`,
          [content, JSON.stringify(meta)],
        );
        thoughtId = rows[0].id; action = "created";
      }
    }

    return {
      thought_id: thoughtId, action, type,
      sensitivity_tier: String(meta.sensitivity_tier),
      content_fingerprint: ob1Fp(content),
      message: "Thought captured",
    };
  } finally {
    client.release();
  }
}

app.get("/ob1/rest/thoughts", async (c) => {
  const q = c.req.query();
  const page = ob1Pi(q.page, 1, 1);
  const perPage = ob1Pi(q.per_page, 25, 1, 100);
  const offset = (page - 1) * perPage;
  const exc = q.exclude_restricted !== "false";

  const sortMap: Record<string, string> = {
    created_at: "created_at",
    importance: "(metadata->>'importance')::numeric",
    quality_score: "(metadata->>'quality_score')::numeric",
    type: "metadata->>'type'",
    status: "metadata->>'status'",
  };
  const sortCol = sortMap[q.sort ?? "created_at"] ?? "created_at";
  const dir = q.order === "asc" ? "ASC" : "DESC";

  const conds: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  if (exc) conds.push("metadata->>'sensitivity_tier' IS DISTINCT FROM 'restricted'");
  if (q.type) { conds.push(`metadata->>'type' = $${p++}`); params.push(q.type); }
  if (q.source_type) {
    conds.push(`(metadata->>'source' = $${p} OR metadata->>'source_type' = $${p})`);
    params.push(q.source_type); p++;
  }
  if (q.status) { conds.push(`metadata->>'status' = $${p++}`); params.push(q.status); }
  if (q.importance_min) { conds.push(`(metadata->>'importance')::numeric >= $${p++}`); params.push(Number(q.importance_min)); }
  if (q.quality_score_max) { conds.push(`(metadata->>'quality_score')::numeric <= $${p++}`); params.push(Number(q.quality_score_max)); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  try {
    const client = await pool.connect();
    try {
      const result = await client.queryObject<OB1Row & { total_count: string }>(
        `SELECT id::text AS id, content, metadata, created_at, COUNT(*) OVER() AS total_count
         FROM thoughts ${where}
         ORDER BY ${sortCol} ${dir} NULLS LAST
         LIMIT $${p} OFFSET $${p + 1}`,
        [...params, perPage, offset],
      );
      const total = result.rows.length ? parseInt(String(result.rows[0].total_count), 10) : 0;
      return c.json({ data: result.rows.map((r) => ob1Norm(r)), total, page, per_page: perPage }, 200, corsHeaders);
    } finally { client.release(); }
  } catch (e) { return c.json({ error: String(e) }, 500, corsHeaders); }
});

app.get("/ob1/rest/thought/:id", async (c) => {
  const id = c.req.param("id");
  const exc = c.req.query("exclude_restricted") !== "false";
  const client = await pool.connect();
  try {
    const { rows } = await client.queryObject<OB1Row>(
      `SELECT id::text AS id, content, metadata, created_at FROM thoughts WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!rows[0]) return c.json({ error: "Not found" }, 404, corsHeaders);
    const t = ob1Norm(rows[0]);
    if (exc && t.sensitivity_tier === "restricted") return c.json({ error: "Restricted thought" }, 403, corsHeaders);
    return c.json(t, 200, corsHeaders);
  } finally { client.release(); }
});

app.put("/ob1/rest/thought/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const client = await pool.connect();
  try {
    const { rows } = await client.queryObject<{ metadata: Record<string, unknown> | null }>(
      `SELECT metadata FROM thoughts WHERE id = $1 LIMIT 1`, [id],
    );
    if (!rows[0]) return c.json({ error: "Not found" }, 404, corsHeaders);
    const merged: Record<string, unknown> = { ...(rows[0].metadata ?? {}) };
    if (body.type !== undefined) merged.type = body.type;
    if (body.importance !== undefined) merged.importance = body.importance;
    if (body.quality_score !== undefined) merged.quality_score = body.quality_score;
    if (body.sensitivity_tier !== undefined) merged.sensitivity_tier = body.sensitivity_tier;
    if (body.status !== undefined) { merged.status = body.status; merged.status_updated_at = new Date().toISOString(); }
    if (body.metadata && typeof body.metadata === "object") Object.assign(merged, body.metadata);
    merged.updated_at = new Date().toISOString();

    if (body.content) {
      try {
        const emb = await getEmbedding(String(body.content));
        await client.queryObject(
          `UPDATE thoughts SET content=$1, embedding=$2::vector, metadata=$3::jsonb WHERE id=$4`,
          [body.content, `[${emb.join(",")}]`, JSON.stringify(merged), id],
        );
      } catch {
        await client.queryObject(
          `UPDATE thoughts SET content=$1, metadata=$2::jsonb WHERE id=$3`,
          [body.content, JSON.stringify(merged), id],
        );
      }
    } else {
      await client.queryObject(
        `UPDATE thoughts SET metadata=$1::jsonb WHERE id=$2`,
        [JSON.stringify(merged), id],
      );
    }
    return c.json({ id, action: "updated", message: "Thought updated" }, 200, corsHeaders);
  } finally { client.release(); }
});

app.delete("/ob1/rest/thought/:id", async (c) => {
  const id = c.req.param("id");
  const client = await pool.connect();
  try {
    await client.queryObject(`DELETE FROM thoughts WHERE id = $1`, [id]);
    return c.json({ id, action: "deleted", message: "Thought deleted" }, 200, corsHeaders);
  } finally { client.release(); }
});

app.post("/ob1/rest/capture", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    return c.json(await ob1CaptureThought(body), 200, corsHeaders);
  } catch (e: unknown) {
    const status = (e as { status?: number }).status === 400 ? 400 : 500;
    return c.json({ error: String(e) }, status, corsHeaders);
  }
});

app.post("/ob1/rest/search", async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const query = String(body.query ?? "").trim();
  if (!query) return c.json({ error: "query is required" }, 400, corsHeaders);

  const mode = body.mode === "text" ? "text" : "semantic";
  const limit = Math.min(100, Math.max(1, parseInt(String(body.limit ?? "25"), 10)));
  const page = Math.max(1, parseInt(String(body.page ?? "1"), 10));
  const threshold = typeof body.threshold === "number" ? body.threshold : 0.35;
  const exc = body.exclude_restricted !== false;
  const offset = (page - 1) * limit;

  if (mode === "text") {
    const client = await pool.connect();
    try {
      const { rows } = await client.queryObject<OB1Row>(
        `SELECT id::text AS id, content, metadata, created_at FROM thoughts
         WHERE content ILIKE $1 ORDER BY created_at DESC LIMIT $2`,
        [`%${query}%`, limit * 3],
      );
      const all = rows.map((r, i) => ob1Norm(r, { rank: i + 1 }))
        .filter((r) => !exc || r.sensitivity_tier !== "restricted");
      const results = all.slice(offset, offset + limit);
      return c.json({ results, count: results.length, total: all.length, page, per_page: limit, total_pages: Math.ceil(all.length / limit), mode: "text" }, 200, corsHeaders);
    } finally { client.release(); }
  }

  try {
    const emb = await getEmbedding(query);
    const embStr = `[${emb.join(",")}]`;
    const fetchCount = Math.min(100, limit * page * 3);
    const client = await pool.connect();
    try {
      const { rows } = await client.queryObject<OB1Row & { similarity: string }>(
        `SELECT id::text AS id, content, metadata, created_at,
                (1-(embedding<=>$1::vector)) AS similarity
         FROM thoughts
         WHERE embedding IS NOT NULL AND (1-(embedding<=>$1::vector)) >= $2
         ORDER BY similarity DESC
         LIMIT $3`,
        [embStr, threshold, fetchCount],
      );
      const all = rows.map((r, i) => ob1Norm(r, { similarity: Number(r.similarity), rank: i + 1 }))
        .filter((r) => !exc || r.sensitivity_tier !== "restricted");
      const results = all.slice(offset, offset + limit);
      return c.json({ results, count: results.length, total: all.length, page, per_page: limit, total_pages: Math.ceil(all.length / limit), mode: "semantic" }, 200, corsHeaders);
    } finally { client.release(); }
  } catch (e) {
    return c.json({ error: String(e) }, 500, corsHeaders);
  }
});

app.get("/ob1/rest/stats", async (c) => {
  const days = ob1Pi(c.req.query("days"), 0, 0, 3650);
  const exc = c.req.query("exclude_restricted") !== "false";

  const sinceCond = days > 0 ? `AND created_at > NOW() - '${days} days'::interval` : "";
  const excCond = exc ? "AND metadata->>'sensitivity_tier' IS DISTINCT FROM 'restricted'" : "";
  const baseCond = `WHERE 1=1 ${sinceCond} ${excCond}`;

  const client = await pool.connect();
  try {
    const { rows: totRows } = await client.queryObject<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM thoughts ${baseCond}`,
    );
    const { rows: typeRows } = await client.queryObject<{ type: string; count: number }>(
      `SELECT COALESCE(metadata->>'type','observation') AS type, COUNT(*)::int AS count
       FROM thoughts ${baseCond} GROUP BY 1`,
    );
    const types: Record<string, number> = {};
    for (const r of typeRows) types[String(r.type)] = Number(r.count);
    return c.json({ total_thoughts: totRows[0]?.total ?? 0, window_days: days || "all", types, top_topics: [] }, 200, corsHeaders);
  } finally { client.release(); }
});

app.get("/ob1/rest/duplicates", async (c) => {
  const threshold = Number(c.req.query("threshold") ?? 0.85);
  const limit = ob1Pi(c.req.query("limit"), 50, 1, 100);
  const offset = ob1Pi(c.req.query("offset"), 0, 0, 10000);

  const client = await pool.connect();
  try {
    const { rows } = await client.queryObject<OB1Row>(
      `SELECT id::text AS id, content, metadata, created_at FROM thoughts ORDER BY created_at DESC LIMIT 250`,
    );
    const thoughts = rows.map((r) => ob1Norm(r));
    const pairs = [];
    for (let i = 0; i < thoughts.length; i++) {
      for (let j = i + 1; j < thoughts.length; j++) {
        const a = thoughts[i], b = thoughts[j];
        const exact = ob1Fp(String(a.content)) === ob1Fp(String(b.content));
        const sim = exact ? 1 : ob1TokenSim(String(a.content), String(b.content));
        if (sim >= threshold) {
          pairs.push({ thought_id_a: a.id, thought_id_b: b.id, similarity: sim, content_a: a.content, content_b: b.content, type_a: a.type, type_b: b.type, quality_a: a.quality_score, quality_b: b.quality_score, created_a: a.created_at, created_b: b.created_at });
        }
      }
    }
    pairs.sort((a, b) => b.similarity - a.similarity);
    return c.json({ pairs: pairs.slice(offset, offset + limit), threshold, limit, offset }, 200, corsHeaders);
  } finally { client.release(); }
});

app.get("/ob1/rest/thought/:id/connections", async (c) => {
  const id = c.req.param("id");
  const limit = ob1Pi(c.req.query("limit"), 20, 1, 50);
  const exc = c.req.query("exclude_restricted") !== "false";

  const client = await pool.connect();
  try {
    const { rows } = await client.queryObject<OB1Row & { similarity: string }>(
      `SELECT t.id::text AS id, t.content, t.metadata, t.created_at,
              (1-(t.embedding<=>sub.emb)) AS similarity
       FROM thoughts t,
            (SELECT embedding AS emb FROM thoughts WHERE id = $1) sub
       WHERE t.id != $1 AND t.embedding IS NOT NULL
       ORDER BY t.embedding<=>sub.emb
       LIMIT $2`,
      [id, limit],
    );
    const results = rows.map((r) => ob1Norm(r, { similarity: Number(r.similarity) }))
      .filter((r) => !exc || r.sensitivity_tier !== "restricted");
    return c.json({ connections: results }, 200, corsHeaders);
  } catch {
    return c.json({ connections: [] }, 200, corsHeaders);
  } finally { client.release(); }
});

app.get("/ob1/rest/thought/:id/reflection", (c) => c.json({ reflections: [] }, 200, corsHeaders));
app.post("/ob1/rest/thought/:id/reflection", (c) => c.json({ error: "reflections not supported in local deployment" }, 501, corsHeaders));

app.get("/ob1/rest/ingestion-jobs", (c) => c.json({ jobs: [], count: 0 }, 200, corsHeaders));
app.get("/ob1/rest/ingestion-jobs/:id", (c) => c.json({ job: null, items: [] }, 200, corsHeaders));
app.post("/ob1/rest/ingestion-jobs/:id/execute", (c) => c.json({ status: "not_configured" }, 200, corsHeaders));

app.post("/ob1/rest/ingest", async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const text = String(body.text ?? "").trim();
  if (!text) return c.json({ error: "text is required" }, 400, corsHeaders);
  try {
    const result = await ob1CaptureThought({ content: text, source_type: "dashboard_ingest" });
    return c.json({ job_id: 0, status: "complete", extracted_count: 1, thought_id: result.thought_id }, 200, corsHeaders);
  } catch (e) {
    return c.json({ error: String(e) }, 500, corsHeaders);
  }
});

// ===========================================================================
// MCP catch-all (must come after all REST routes)
// ===========================================================================

app.all("*", async (c) => {
  // Auth handled by middleware above.
  const mcpStart = Date.now();
  let toolName: string | null = null;

  // Buffer POST body to extract the MCP tool name for telemetry, then reconstruct
  // the request so the transport can read it. Body streams are single-use.
  const isPost = c.req.method === "POST";
  let bodyText: string | null = null;
  if (isPost) {
    bodyText = await c.req.text().catch(() => null);
    if (bodyText) {
      try {
        const rpc = JSON.parse(bodyText);
        if (rpc.method === "tools/call" && typeof rpc.params?.name === "string") {
          toolName = rpc.params.name;
        }
      } catch { /* non-JSON or non-tool-call */ }
    }
  }

  // Fix: patch missing or incomplete Accept header — StreamableHTTPTransport requires both
  // application/json and text/event-stream. Also re-attach body after reading above.
  const needsAcceptPatch = !c.req.header("accept")?.includes("text/event-stream");
  if (isPost || needsAcceptPatch) {
    const headers = new Headers(c.req.raw.headers);
    if (needsAcceptPatch) {
      headers.set("Accept", "application/json, text/event-stream");
    }
    const patched = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers,
      body: isPost ? (bodyText ?? "") : c.req.raw.body,
      // @ts-ignore -- duplex required for streaming body in Deno
      duplex: "half",
    });
    Object.defineProperty(c.req, "raw", { value: patched, writable: true });
  }

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  const response = await transport.handleRequest(c);

  traceSpan({
    name: toolName ? `mcp-tool:${toolName}` : "mcp-request",
    tags: ["service:job-search-mcp", ...(toolName ? [`tool:${toolName}`] : [])],
    metadata: { tool: toolName, duration_ms: Date.now() - mcpStart },
    durationMs: Date.now() - mcpStart,
  }).catch(() => {});

  return response;
});

Deno.serve({ port: parseInt(Deno.env.get("PORT") || "8001", 10) }, app.fetch);
