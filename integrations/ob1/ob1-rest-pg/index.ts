// REST API shim: exposes the same HTTP interface as open-brain-rest but reads/writes
// directly to local PostgreSQL instead of Supabase. All extended fields (type,
// importance, etc.) are stored in the thoughts.metadata JSONB column because the
// local schema only has: id, content, embedding, metadata, created_at.

import { Hono } from "hono";
import postgres from "postgres";

const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;
const PORT = parseInt(Deno.env.get("PORT") || "8002");

const sql = postgres(
  `postgresql://${Deno.env.get("DB_USER")}:${encodeURIComponent(Deno.env.get("DB_PASSWORD")!)}@${Deno.env.get("DB_HOST")}:${Deno.env.get("DB_PORT")}/${Deno.env.get("DB_NAME")}`,
  { max: 10, idle_timeout: 30 }
);

const EMBEDDING_API_BASE = Deno.env.get("EMBEDDING_API_BASE") || "https://openrouter.ai/api/v1";
const EMBEDDING_API_KEY = Deno.env.get("EMBEDDING_API_KEY")!;
const EMBEDDING_MODEL = Deno.env.get("EMBEDDING_MODEL") || "openai/text-embedding-3-small";

// ── Helpers ──────────────────────────────────────────────────────────────────

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-brain-key",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

type Row = { id: number | string; content: string; metadata: Record<string, unknown> | null; created_at: string };

function m(row: Row): Record<string, unknown> {
  return (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
}

function n(v: unknown, d: number) { const x = Number(v); return Number.isFinite(x) ? x : d; }
function s(v: unknown): string | null { return typeof v === "string" && v.trim() ? v : null; }
function ip(v: string | null, d: number, min = 0, max = 100000) { const x = parseInt(v || "", 10); return Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : d; }

function normalize(row: Row, extra: Record<string, unknown> = {}) {
  const meta = m(row);
  const type = s(meta.type) || "observation";
  const srcType = s(meta.source) || s(meta.source_type) || "unknown";
  const sensitivity = s(meta.sensitivity_tier) || "standard";
  return {
    id: String(row.id), uuid: String(row.id),
    content: row.content, type, source_type: srcType,
    importance: n(meta.importance, 50), quality_score: n(meta.quality_score, 50),
    sensitivity_tier: sensitivity, metadata: meta,
    created_at: row.created_at, updated_at: s(meta.updated_at) || row.created_at,
    status: s(meta.status), status_updated_at: s(meta.status_updated_at),
    ...extra,
  };
}

async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${EMBEDDING_API_BASE}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${EMBEDDING_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`Embedding API ${res.status}`);
  return (await res.json()).data[0].embedding;
}

function fp(text: string) { return text.toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s]/g, "").trim(); }

function tokenSim(a: string, b: string) {
  const at = new Set(a.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  const bt = new Set(b.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  if (!at.size || !bt.size) return 0;
  let inter = 0; for (const t of at) if (bt.has(t)) inter++;
  return inter / new Set([...at, ...bt]).size;
}

// ── App ───────────────────────────────────────────────────────────────────────

const app = new Hono();

app.options("*", (c) => c.text("ok", 200, cors));

app.use("*", async (c, next) => {
  const key = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (!key || key !== MCP_ACCESS_KEY) return c.json({ error: "Invalid or missing access key" }, 401, cors);
  await next();
});

app.get("/health", (c) => c.json({ ok: true, status: "ok", service: "open-brain-rest-pg", version: "0.1.0" }, 200, cors));

// ── List thoughts ─────────────────────────────────────────────────────────────

app.get("/thoughts", async (c) => {
  const u = new URL(c.req.url);
  const page = ip(u.searchParams.get("page"), 1, 1), perPage = ip(u.searchParams.get("per_page"), 25, 1, 100);
  const offset = (page - 1) * perPage;
  const exc = u.searchParams.get("exclude_restricted") !== "false";
  const type = u.searchParams.get("type"), src = u.searchParams.get("source_type");
  const status = u.searchParams.get("status"), impMin = u.searchParams.get("importance_min");
  const qMax = u.searchParams.get("quality_score_max");

  const sortMap: Record<string, string> = {
    created_at: "created_at", importance: "(metadata->>'importance')::numeric",
    quality_score: "(metadata->>'quality_score')::numeric", type: "metadata->>'type'",
    status: "metadata->>'status'",
  };
  const sortKey = u.searchParams.get("sort") || "created_at";
  const sortCol = sortMap[sortKey] || "created_at";
  const dir = u.searchParams.get("order") === "asc" ? "ASC" : "DESC";

  try {
    const rows = await sql`
      SELECT id, content, metadata, created_at, COUNT(*) OVER() AS total_count
      FROM thoughts
      WHERE TRUE
        ${exc ? sql`AND metadata->>'sensitivity_tier' IS DISTINCT FROM 'restricted'` : sql``}
        ${type ? sql`AND metadata->>'type' = ${type}` : sql``}
        ${src ? sql`AND (metadata->>'source' = ${src} OR metadata->>'source_type' = ${src})` : sql``}
        ${status ? sql`AND metadata->>'status' = ${status}` : sql``}
        ${impMin ? sql`AND (metadata->>'importance')::numeric >= ${Number(impMin)}` : sql``}
        ${qMax ? sql`AND (metadata->>'quality_score')::numeric <= ${Number(qMax)}` : sql``}
      ORDER BY ${sql.unsafe(sortCol)} ${sql.unsafe(dir)} NULLS LAST
      LIMIT ${perPage} OFFSET ${offset}
    `;
    const total = rows.length ? parseInt(String(rows[0].total_count), 10) : 0;
    return c.json({ data: rows.map((r) => normalize(r as Row)), total, page, per_page: perPage }, 200, cors);
  } catch (e) {
    return c.json({ error: String(e) }, 500, cors);
  }
});

// ── Single thought ────────────────────────────────────────────────────────────

app.get("/thought/:id", async (c) => {
  const exc = new URL(c.req.url).searchParams.get("exclude_restricted") !== "false";
  const [row] = await sql<Row[]>`SELECT id, content, metadata, created_at FROM thoughts WHERE id = ${c.req.param("id")} LIMIT 1`;
  if (!row) return c.json({ error: "Not found" }, 404, cors);
  const t = normalize(row);
  if (exc && t.sensitivity_tier === "restricted") return c.json({ error: "Restricted thought" }, 403, cors);
  return c.json(t, 200, cors);
});

// ── Update thought ────────────────────────────────────────────────────────────

app.put("/thought/:id", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const [existing] = await sql`SELECT metadata FROM thoughts WHERE id = ${c.req.param("id")} LIMIT 1`;
  if (!existing) return c.json({ error: "Not found" }, 404, cors);

  const merged: Record<string, unknown> = { ...(existing.metadata || {}) };
  if (body.type !== undefined) merged.type = body.type;
  if (body.importance !== undefined) merged.importance = body.importance;
  if (body.quality_score !== undefined) merged.quality_score = body.quality_score;
  if (body.sensitivity_tier !== undefined) merged.sensitivity_tier = body.sensitivity_tier;
  if (body.status !== undefined) { merged.status = body.status; merged.status_updated_at = new Date().toISOString(); }
  if (body.metadata) Object.assign(merged, body.metadata);
  merged.updated_at = new Date().toISOString();

  if (body.content) {
    try {
      const emb = await embed(body.content);
      await sql`UPDATE thoughts SET content=${body.content}, embedding=${`[${emb.join(",")}]`}::vector, metadata=${merged} WHERE id=${c.req.param("id")}`;
    } catch {
      await sql`UPDATE thoughts SET content=${body.content}, metadata=${merged} WHERE id=${c.req.param("id")}`;
    }
  } else {
    await sql`UPDATE thoughts SET metadata=${merged} WHERE id=${c.req.param("id")}`;
  }
  return c.json({ id: c.req.param("id"), action: "updated", message: "Thought updated" }, 200, cors);
});

// ── Delete thought ────────────────────────────────────────────────────────────

app.delete("/thought/:id", async (c) => {
  await sql`DELETE FROM thoughts WHERE id=${c.req.param("id")}`;
  return c.json({ id: c.req.param("id"), action: "deleted", message: "Thought deleted" }, 200, cors);
});

// ── Capture ───────────────────────────────────────────────────────────────────

async function captureThought(body: Record<string, unknown>) {
  const content = String(body.content || "").trim();
  if (!content) throw Object.assign(new Error("content is required"), { status: 400 });

  const type = String(body.type || "observation");
  const srcType = String(body.source_type || "dashboard");
  const status = body.status !== undefined ? body.status : (["task", "idea"].includes(type) ? "new" : null);
  const meta: Record<string, unknown> = {
    type, source: srcType, source_type: srcType,
    importance: body.importance ?? 50, quality_score: body.quality_score ?? 70,
    sensitivity_tier: body.sensitivity_tier || "standard",
    ...(typeof body.metadata === "object" && body.metadata !== null ? body.metadata : {}),
    status, status_updated_at: status ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const [existing] = await sql`SELECT id FROM thoughts WHERE content=${content} LIMIT 1`;
  let thoughtId: string;
  let action: string;

  try {
    const emb = await embed(content);
    const embStr = `[${emb.join(",")}]`;
    if (existing) {
      await sql`UPDATE thoughts SET embedding=${embStr}::vector, metadata=${meta} WHERE id=${existing.id}`;
      thoughtId = String(existing.id); action = "updated";
    } else {
      const [ins] = await sql`INSERT INTO thoughts (content, embedding, metadata) VALUES (${content}, ${embStr}::vector, ${meta}) RETURNING id`;
      thoughtId = String(ins.id); action = "created";
    }
  } catch (_embErr) {
    if (existing) {
      await sql`UPDATE thoughts SET metadata=${meta} WHERE id=${existing.id}`;
      thoughtId = String(existing.id); action = "updated";
    } else {
      const [ins] = await sql`INSERT INTO thoughts (content, metadata) VALUES (${content}, ${meta}) RETURNING id`;
      thoughtId = String(ins.id); action = "created";
    }
  }

  return { thought_id: thoughtId, action, type, sensitivity_tier: String(meta.sensitivity_tier), content_fingerprint: fp(content), message: "Thought captured" };
}

app.post("/capture", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return c.json(await captureThought(body), 200, cors);
  } catch (e: unknown) {
    const status = (e as { status?: number }).status === 400 ? 400 : 500;
    return c.json({ error: String(e) }, status, cors);
  }
});

// ── Search ────────────────────────────────────────────────────────────────────

app.post("/search", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const query = String(body.query || "").trim();
  if (!query) return c.json({ error: "query is required" }, 400, cors);

  const mode = body.mode === "text" ? "text" : "semantic";
  const limit = Math.min(100, Math.max(1, parseInt(body.limit || "25", 10)));
  const page = Math.max(1, parseInt(body.page || "1", 10));
  const threshold = typeof body.threshold === "number" ? body.threshold : 0.35;
  const exc = body.exclude_restricted !== false;
  const offset = (page - 1) * limit;

  if (mode === "text") {
    const rows = await sql<Row[]>`SELECT id, content, metadata, created_at FROM thoughts WHERE content ILIKE ${"%" + query + "%"} ORDER BY created_at DESC LIMIT ${limit * 3}`;
    const all = rows.map((r, i) => normalize(r, { rank: i + 1 })).filter((r) => !exc || r.sensitivity_tier !== "restricted");
    const results = all.slice(offset, offset + limit);
    return c.json({ results, count: results.length, total: all.length, page, per_page: limit, total_pages: Math.ceil(all.length / limit), mode: "text" }, 200, cors);
  }

  // Semantic: use match_thoughts which has a vector index
  try {
    const emb = await embed(query);
    const embStr = `[${emb.join(",")}]`;
    const fetchCount = Math.min(100, limit * page * 3);
    const matches = await sql.unsafe(
      `SELECT id, content, metadata, created_at, (1-(embedding<=>$1::vector)) AS similarity FROM thoughts WHERE embedding IS NOT NULL AND (1-(embedding<=>$1::vector))>=$2 ORDER BY similarity DESC LIMIT $3`,
      [embStr, threshold, fetchCount]
    );
    const all = (matches as Row[]).map((r, i) => normalize(r, { similarity: Number((r as Record<string, unknown>).similarity), rank: i + 1 })).filter((r) => !exc || r.sensitivity_tier !== "restricted");
    const results = all.slice(offset, offset + limit);
    return c.json({ results, count: results.length, total: all.length, page, per_page: limit, total_pages: Math.ceil(all.length / limit), mode: "semantic" }, 200, cors);
  } catch (e) {
    return c.json({ error: String(e) }, 500, cors);
  }
});

// ── Stats ─────────────────────────────────────────────────────────────────────

app.get("/stats", async (c) => {
  const u = new URL(c.req.url);
  const days = ip(u.searchParams.get("days"), 0, 0, 3650);
  const exc = u.searchParams.get("exclude_restricted") !== "false";

  const since = days > 0 ? sql`AND created_at > NOW() - ${`${days} days`}::interval` : sql``;
  const excCond = exc ? sql`AND metadata->>'sensitivity_tier' IS DISTINCT FROM 'restricted'` : sql``;

  const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM thoughts WHERE 1=1 ${since} ${excCond}`;
  const typeRows = await sql`SELECT COALESCE(metadata->>'type','observation') AS type, COUNT(*)::int AS count FROM thoughts WHERE 1=1 ${since} ${excCond} GROUP BY 1`;

  const types: Record<string, number> = {};
  for (const r of typeRows) types[String(r.type)] = Number(r.count);

  return c.json({ total_thoughts: total, window_days: days || "all", types, top_topics: [] }, 200, cors);
});

// ── Duplicates ────────────────────────────────────────────────────────────────

app.get("/duplicates", async (c) => {
  const u = new URL(c.req.url);
  const threshold = Number(u.searchParams.get("threshold") || 0.85);
  const limit = ip(u.searchParams.get("limit"), 50, 1, 100);
  const offset = ip(u.searchParams.get("offset"), 0, 0, 10000);

  const rows = await sql<Row[]>`SELECT id, content, metadata, created_at FROM thoughts ORDER BY created_at DESC LIMIT 250`;
  const thoughts = rows.map(normalize);
  const pairs = [];
  for (let i = 0; i < thoughts.length; i++) {
    for (let j = i + 1; j < thoughts.length; j++) {
      const a = thoughts[i], b = thoughts[j];
      const exact = fp(a.content) === fp(b.content);
      const sim = exact ? 1 : tokenSim(a.content, b.content);
      if (sim >= threshold) {
        pairs.push({ thought_id_a: a.id, thought_id_b: b.id, similarity: sim, content_a: a.content, content_b: b.content, type_a: a.type, type_b: b.type, quality_a: a.quality_score, quality_b: b.quality_score, created_a: a.created_at, created_b: b.created_at });
      }
    }
  }
  pairs.sort((a, b) => b.similarity - a.similarity);
  return c.json({ pairs: pairs.slice(offset, offset + limit), threshold, limit, offset }, 200, cors);
});

// ── Connections ───────────────────────────────────────────────────────────────

app.get("/thought/:id/connections", async (c) => {
  const id = c.req.param("id");
  const limit = ip(new URL(c.req.url).searchParams.get("limit"), 20, 1, 50);
  const exc = new URL(c.req.url).searchParams.get("exclude_restricted") !== "false";

  try {
    const connections = await sql.unsafe(
      `SELECT id, content, metadata, created_at, (1-(embedding<=>sub.emb)) AS similarity FROM thoughts, (SELECT embedding AS emb FROM thoughts WHERE id=$1) sub WHERE id!=$1 AND embedding IS NOT NULL ORDER BY embedding<=>sub.emb LIMIT $2`,
      [id, limit]
    );
    const results = (connections as Row[]).map((r) => normalize(r, { similarity: Number((r as Record<string, unknown>).similarity) })).filter((r) => !exc || r.sensitivity_tier !== "restricted");
    return c.json({ connections: results }, 200, cors);
  } catch {
    return c.json({ connections: [] }, 200, cors);
  }
});

// ── Reflections (stub) ────────────────────────────────────────────────────────

app.get("/thought/:id/reflection", (c) => c.json({ reflections: [] }, 200, cors));
app.post("/thought/:id/reflection", (c) => c.json({ error: "reflections not supported in local deployment" }, 501, cors));

// ── Ingestion ─────────────────────────────────────────────────────────────────

app.get("/ingestion-jobs", (c) => c.json({ jobs: [], count: 0 }, 200, cors));
app.get("/ingestion-jobs/:id", (c) => c.json({ job: null, items: [] }, 200, cors));
app.post("/ingestion-jobs/:id/execute", (c) => c.json({ status: "not_configured" }, 200, cors));

app.post("/ingest", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const text = String(body.text || "").trim();
  if (!text) return c.json({ error: "text is required" }, 400, cors);
  try {
    const result = await captureThought({ content: text, source_type: "dashboard_ingest" });
    return c.json({ job_id: 0, status: "complete", extracted_count: 1, thought_id: result.thought_id }, 200, cors);
  } catch (e) {
    return c.json({ error: String(e) }, 500, cors);
  }
});

Deno.serve({ port: PORT }, app.fetch);
