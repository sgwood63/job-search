/**
 * Job Search MCP Sidecar
 *
 * Runs alongside the Open Brain MCP server as a separate Kubernetes Deployment.
 * Shares the same PostgreSQL database (js_* tables) and MinIO object store.
 * Provides 16 MCP tools for file storage, pipeline state, and semantic search.
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
import { registerJobSearchTools } from "./job-search-tools.ts";

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
  const [embedding, extracted] = await Promise.all([
    getEmbedding(content),
    extractMetadata(content),
  ]);
  const meta = { ...extracted, ...metadata, source: "job-search-mcp" };
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

// --- Hono App with Auth ---

const app = new Hono();

app.all("*", async (c) => {
  const provided = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json({ error: "Invalid or missing access key" }, 401);
  }
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve({ port: parseInt(Deno.env.get("PORT") || "8001", 10) }, app.fetch);
