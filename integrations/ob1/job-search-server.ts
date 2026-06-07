/**
 * Job Search MCP Sidecar
 *
 * Runs alongside the Open Brain MCP server as a separate Kubernetes Deployment.
 * Shares the same PostgreSQL database (js_* tables) and MinIO object store.
 * Provides 16 MCP tools for file storage, pipeline state, and semantic search,
 * plus a REST API at /api/v2/* for direct webapp access.
 *
 * Environment variables:
 *   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD   PostgreSQL (same cluster as OB1)
 *   EMBEDDING_API_BASE, EMBEDDING_API_KEY, EMBEDDING_MODEL   for thought capture
 *   CHAT_API_BASE, CHAT_API_KEY, CHAT_MODEL   for metadata extraction
 *   OBJECT_STORE_BACKEND   'minio' (default) or 'supabase'
 *   MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_BUCKET   (if using Supabase storage)
 *   MCP_ACCESS_KEY   authentication key for this server
 *   PORT   HTTP port (default: 8001)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { Pool } from "postgres";
import {
  registerJobSearchTools,
  uploadFileCore, getFileCore, getFileUrlCore, listFilesCore, deleteFileCore, deleteApplicationCore,
  getPipelineCore, getApplicationCore, getProfilesCore, getOverdueFollowupsCore,
  createApplicationCore, updateApplicationStatusCore, logInterviewCore, completeInterviewCore,
  addContactCore, upsertCompanyCore, searchApplicationsSemanticCore,
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
  return d.choices[0].message.content as string;
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
  try {
    return JSON.parse(d.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
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

// --- MCP Server ---

const server = new McpServer({
  name: "job-search",
  version: "1.0.0",
});

registerJobSearchTools(server, pool, { captureThought, searchThoughts });

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
  if (c.req.path.startsWith("/api/")) {
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

// ===========================================================================
// REST API — /api/v2/*
// ===========================================================================

// --- File routes ---

app.put("/api/v2/files/*", async (c) => {
  const key = c.req.path.slice("/api/v2/files/".length);
  const body = await c.req.json();
  const result = await uploadFileCore(pool, captureThought, {
    key,
    content: body.content,
    content_type: body.content_type ?? "text/markdown",
    binary: body.binary ?? false,
  });
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
  const { bytes, contentType } = await getFileCore(key);
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
  const result = await getApplicationCore(pool, id);
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

app.get("/api/v2/overdue", async (c) => {
  const rows = await getOverdueFollowupsCore(pool);
  return c.json(rows, 200, corsHeaders);
});

// --- Semantic search ---

app.post("/api/v2/search", async (c) => {
  const { query, limit = 5 } = await c.req.json();
  const results = await searchApplicationsSemanticCore(searchThoughts, query, limit);
  if (results === null) return c.json({ error: "Search not configured" }, 503, corsHeaders);
  return c.json(results, 200, corsHeaders);
});

// ===========================================================================
// MCP catch-all (must come after all REST routes)
// ===========================================================================

app.all("*", async (c) => {
  // Auth handled by middleware above.
  // Fix: patch missing or incomplete Accept header — StreamableHTTPTransport requires both
  // application/json and text/event-stream.
  if (!c.req.header("accept")?.includes("text/event-stream")) {
    const headers = new Headers(c.req.raw.headers);
    headers.set("Accept", "application/json, text/event-stream");
    const patched = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers,
      body: c.req.raw.body,
      // @ts-ignore -- duplex required for streaming body in Deno
      duplex: "half",
    });
    Object.defineProperty(c.req, "raw", { value: patched, writable: true });
  }

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve({ port: parseInt(Deno.env.get("PORT") || "8001", 10) }, app.fetch);
