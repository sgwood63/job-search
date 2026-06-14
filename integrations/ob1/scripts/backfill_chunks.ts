/**
 * backfill_chunks.ts — One-time migration script (Phase 2)
 *
 * Reads all js_files rows with text/* content_type, fetches each file from MinIO,
 * chunks it at H2 boundaries, embeds each chunk, and inserts into js_chunks.
 *
 * Run after Phase 2 deployment:
 *   deno run --allow-net --allow-env \
 *     integrations/ob1/scripts/backfill_chunks.ts
 *
 * Expected runtime: ~2 minutes per 100 files (limited by embedding API rate).
 * Safe to re-run: deletes existing js_chunks rows before re-inserting (idempotent).
 */

import { Pool } from "postgres";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { chunkMarkdown } from "../job-search-tools.ts";

// --- Config ---

const DB_HOST     = Deno.env.get("DB_HOST")     || "127.0.0.1";
const DB_PORT     = parseInt(Deno.env.get("DB_PORT") || "5432", 10);
const DB_NAME     = Deno.env.get("DB_NAME")     || "openbrain";
const DB_USER     = Deno.env.get("DB_USER")     || "postgres";
const DB_PASSWORD = Deno.env.get("DB_PASSWORD")!;

const EMBEDDING_API_BASE = Deno.env.get("EMBEDDING_API_BASE") || "https://openrouter.ai/api/v1";
const EMBEDDING_API_KEY  = Deno.env.get("EMBEDDING_API_KEY")  || Deno.env.get("LLM_API_KEY") || "";
const EMBEDDING_MODEL    = Deno.env.get("EMBEDDING_MODEL")    || "openai/text-embedding-3-small";

const MINIO_ENDPOINT   = Deno.env.get("MINIO_ENDPOINT") || "minio.openbrain.svc.cluster.local:9000";
const MINIO_ACCESS_KEY = Deno.env.get("MINIO_ACCESS_KEY")!;
const MINIO_SECRET_KEY = Deno.env.get("MINIO_SECRET_KEY")!;
const BUCKET           = Deno.env.get("MINIO_BUCKET") || "job-search";

// --- Clients ---

const pool = new Pool({ hostname: DB_HOST, port: DB_PORT, database: DB_NAME, user: DB_USER, password: DB_PASSWORD }, 3);

const s3 = new S3Client({
  region: "us-east-1",
  endpoint: `http://${MINIO_ENDPOINT}`,
  credentials: { accessKeyId: MINIO_ACCESS_KEY, secretAccessKey: MINIO_SECRET_KEY },
  forcePathStyle: true,
});

// --- Helpers ---

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${EMBEDDING_API_BASE}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${EMBEDDING_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });
  if (!r.ok) throw new Error(`Embedding API failed: ${r.status} ${await r.text().catch(() => "")}`);
  const d = await r.json();
  return d.data[0].embedding;
}

async function fetchText(key: string): Promise<string | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const reader = (res.Body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { out.set(c, offset); offset += c.length; }
    return new TextDecoder().decode(out);
  } catch (e) {
    console.warn(`  SKIP (fetch failed): ${(e as Error).message}`);
    return null;
  }
}

// --- Main ---

const client = await pool.connect();
const { rows: files } = await client.queryObject<{ id: string; storage_key: string }>(
  `SELECT id::text AS id, storage_key FROM js_files
   WHERE content_type LIKE 'text/%' OR content_type = 'application/json'
   ORDER BY storage_key`,
);
client.release();

console.log(`Backfilling chunks for ${files.length} text files…`);
let ok = 0, skipped = 0, errored = 0;

for (const file of files) {
  process.stdout.write(`  ${file.storage_key} … `);
  const content = await fetchText(file.storage_key);
  if (!content) { skipped++; continue; }

  const chunks = chunkMarkdown(content);
  if (chunks.length === 0) {
    console.log(`(no chunks)`);
    skipped++;
    continue;
  }

  const c = await pool.connect();
  try {
    await c.queryObject(`DELETE FROM js_chunks WHERE storage_key = $1`, [file.storage_key]);

    for (const chunk of chunks) {
      let thoughtId: string | null = null;
      try {
        const embedding = await getEmbedding(chunk.content);
        const embStr = `[${embedding.join(",")}]`;
        const { rows } = await c.queryObject<{ id: string }>(
          `INSERT INTO thoughts (content, embedding, metadata)
           VALUES ($1, $2::vector, $3::jsonb) RETURNING id::text AS id`,
          [
            chunk.content,
            embStr,
            JSON.stringify({
              type: "file-chunk",
              storage_key: file.storage_key,
              section_title: chunk.title,
              section_index: chunk.index,
              source: "job-search-mcp",
            }),
          ],
        );
        thoughtId = rows[0].id;
      } catch (e) {
        console.warn(`    chunk ${chunk.index} embed failed: ${(e as Error).message}`);
      }

      await c.queryObject(
        `INSERT INTO js_chunks (storage_key, file_id, section_title, section_index, content, char_count, thought_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [file.storage_key, file.id, chunk.title, chunk.index, chunk.content, chunk.content.length, thoughtId],
      );
    }

    console.log(`${chunks.length} chunks`);
    ok++;
  } catch (e) {
    console.error(`  ERROR: ${(e as Error).message}`);
    errored++;
  } finally {
    c.release();
  }

  // Gentle rate-limiting: pause briefly between files to avoid embedding API saturation
  await new Promise(r => setTimeout(r, 200));
}

await pool.end();
console.log(`\nDone: ${ok} processed, ${skipped} skipped, ${errored} errors`);
