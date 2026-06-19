/**
 * Job Search MCP Tools for OB1
 *
 * Imported by job-search-server.ts (the sidecar entry point).
 * Prerequisites: job-search-schema.sql applied to the OB1 Postgres instance.
 *
 * Each tool is split into:
 *   - A *Core() exported function containing the business logic
 *   - A register*Tool() wrapper that adapts the core to the MCP tool protocol
 *
 * The *Core() functions are also called directly by the REST API routes in
 * job-search-server.ts, ensuring a single code path for both Claude Code and
 * the webapp.
 */

import { z } from "zod";
import { traceSpan } from "./langfuse_ts.ts";
import { S3Client, PutObjectCommand, GetObjectCommand,
         ListObjectsV2Command, DeleteObjectCommand,
         GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ---------------------------------------------------------------------------
// Object store client (MinIO or Supabase Storage, configured by env)
// ---------------------------------------------------------------------------

const OBJECT_STORE_BACKEND = Deno.env.get("OBJECT_STORE_BACKEND") ?? "minio";
const BUCKET = Deno.env.get("MINIO_BUCKET") ?? Deno.env.get("SUPABASE_BUCKET") ?? "job-search";

function makeS3Client(): S3Client {
  if (OBJECT_STORE_BACKEND === "supabase") {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const projectRef = supabaseUrl.replace("https://", "").replace(".supabase.co", "");
    return new S3Client({
      region: "auto",
      endpoint: `https://${projectRef}.supabase.co/storage/v1/s3`,
      credentials: {
        accessKeyId: Deno.env.get("SUPABASE_SERVICE_KEY")!,
        secretAccessKey: Deno.env.get("SUPABASE_SERVICE_KEY")!,
      },
      forcePathStyle: true,
    });
  }
  // MinIO (local K8s, default)
  return new S3Client({
    region: "us-east-1",
    endpoint: `http://${Deno.env.get("MINIO_ENDPOINT") ?? "minio.openbrain.svc.cluster.local:9000"}`,
    credentials: {
      accessKeyId: Deno.env.get("MINIO_ACCESS_KEY")!,
      secretAccessKey: Deno.env.get("MINIO_SECRET_KEY")!,
    },
    forcePathStyle: true,
  });
}

const s3 = makeS3Client();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function streamToBytes(stream: unknown): Promise<Uint8Array> {
  if (typeof (stream as any).transformToByteArray === "function") {
    return (stream as any).transformToByteArray();
  }
  const reader = (stream as ReadableStream<Uint8Array>).getReader();
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
  return out;
}

function isTextType(contentType: string): boolean {
  return contentType.startsWith("text/") || contentType === "application/json";
}

export type CaptureThoughtFn = (content: string, metadata: Record<string, unknown>) => Promise<string>;
export type SearchThoughtsFn = (
  query: string,
  limit: number,
  filter: Record<string, unknown>,
) => Promise<Array<{ id: string; content: string; metadata: Record<string, unknown>; similarity: number; created_at: string }>>;
export type EmbedQueryFn = (query: string) => Promise<number[]>;
export type ChunkContentFn = (content: string, storageKey: string) => Promise<void>;
export type JobSearchCallbacks = {
  captureThought?: CaptureThoughtFn;
  searchThoughts?: SearchThoughtsFn;
  embedQuery?: EmbedQueryFn;
  chunkContent?: ChunkContentFn;
};

// ---------------------------------------------------------------------------
// chunkMarkdown: split a markdown document into H2-section-level chunks
// ---------------------------------------------------------------------------

export interface MarkdownChunk {
  title: string | null;
  index: number;
  content: string;
}

export function chunkMarkdown(text: string): MarkdownChunk[] {
  const MAX_CHUNK = 8000;
  const MIN_CHUNK = 30;
  const chunks: MarkdownChunk[] = [];
  // Split on H2 boundaries; keep the ## header with its section
  const parts = text.split(/(?=\n## )/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length < MIN_CHUNK) continue;
    const headerMatch = trimmed.match(/^## (.+)/);
    const title = headerMatch ? headerMatch[1].trim() : null;
    // If this chunk is oversized, split at paragraph boundaries
    if (trimmed.length <= MAX_CHUNK) {
      chunks.push({ title, index: chunks.length, content: trimmed });
    } else {
      const paras = trimmed.split(/\n\n+/);
      let buf = "";
      let subIdx = 0;
      for (const para of paras) {
        if (buf.length + para.length + 2 > MAX_CHUNK && buf.length >= MIN_CHUNK) {
          chunks.push({
            title: subIdx === 0 ? title : `${title ?? "…"} (continued ${subIdx})`,
            index: chunks.length,
            content: buf.trim(),
          });
          buf = para;
          subIdx++;
        } else {
          buf = buf ? buf + "\n\n" + para : para;
        }
      }
      if (buf.trim().length >= MIN_CHUNK) {
        chunks.push({
          title: subIdx === 0 ? title : `${title ?? "…"} (continued ${subIdx})`,
          index: chunks.length,
          content: buf.trim(),
        });
      }
    }
  }
  return chunks;
}

// ===========================================================================
// FILE CORE FUNCTIONS
// ===========================================================================

export async function uploadFileCore(
  pool: unknown,
  captureThoughtFn: CaptureThoughtFn | undefined,
  args: { key: string; content: string; content_type: string; binary: boolean },
  chunkContentFn?: ChunkContentFn,
): Promise<{ key: string; bytes: number }> {
  const bytes = args.binary
    ? Uint8Array.from(atob(args.content), c => c.charCodeAt(0))
    : new TextEncoder().encode(args.content);

  let oldThoughtId: string | null = null;
  {
    const c = await (pool as any).connect();
    try {
      const r = await c.queryObject(
        `SELECT thought_id FROM js_files WHERE storage_key = $1`, [args.key],
      );
      oldThoughtId = (r.rows[0] as any)?.thought_id ?? null;
    } finally { c.release(); }
  }

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: args.key, Body: bytes, ContentType: args.content_type,
  }));

  let thoughtId: string | null = null;
  if (!args.binary && isTextType(args.content_type) && args.content.length > 50 && captureThoughtFn) {
    try {
      thoughtId = await captureThoughtFn(args.content, {
        type: "file", storage_key: args.key, content_type: args.content_type,
      });
    } catch { /* best-effort */ }
  }

  {
    const c = await (pool as any).connect();
    try {
      await c.queryObject(
        `INSERT INTO js_files (storage_key, bucket, content_type, file_size, thought_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (storage_key) DO UPDATE SET
           bucket = EXCLUDED.bucket,
           content_type = EXCLUDED.content_type,
           file_size = EXCLUDED.file_size,
           thought_id = COALESCE(EXCLUDED.thought_id, js_files.thought_id),
           updated_at = now()`,
        [args.key, BUCKET, args.content_type, bytes.length, thoughtId],
      );
    } finally { c.release(); }
  }

  if (oldThoughtId && thoughtId && oldThoughtId !== thoughtId) {
    const c = await (pool as any).connect();
    try {
      await c.queryObject(`DELETE FROM thoughts WHERE id = $1`, [oldThoughtId]);
    } catch { /* best-effort */ }
    finally { c.release(); }
  }

  // Phase 2: chunk the document at H2 boundaries for section-level retrieval
  if (!args.binary && isTextType(args.content_type) && args.content.length > 50 && chunkContentFn) {
    try {
      await chunkContentFn(args.content, args.key);
    } catch { /* best-effort — chunking failure does not fail the upload */ }
  }

  return { key: args.key, bytes: bytes.length };
}

export async function getFileCore(key: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res: GetObjectCommandOutput = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const contentType = res.ContentType ?? "application/octet-stream";
  const bytes = await streamToBytes(res.Body as ReadableStream<Uint8Array>);
  return { bytes, contentType };
}

export async function getFileUrlCore(key: string, expiresIn: number): Promise<{ url: string }> {
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
  return { url };
}

export async function listFilesCore(
  pool: unknown,
  prefix: string,
): Promise<Array<{ key: string; content_type: string; size: number; updated_at: string }>> {
  const client = await (pool as any).connect();
  try {
    const { rows } = await client.queryObject(
      `SELECT storage_key, content_type, file_size, updated_at
       FROM js_files WHERE storage_key LIKE $1 ORDER BY storage_key`,
      [prefix + "%"],
    );
    return (rows as any[]).map((r: any) => ({
      key: r.storage_key, content_type: r.content_type, size: r.file_size, updated_at: r.updated_at,
    }));
  } finally { client.release(); }
}

export async function deleteFileCore(pool: unknown, key: string): Promise<{ deleted: string }> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  const client = await (pool as any).connect();
  let thoughtId: string | null = null;
  try {
    const r = await client.queryObject(
      `DELETE FROM js_files WHERE storage_key = $1 RETURNING thought_id::text AS thought_id`, [key],
    );
    thoughtId = (r.rows[0] as any)?.thought_id ?? null;
  } finally { client.release(); }
  if (thoughtId) {
    const c = await (pool as any).connect();
    try { await c.queryObject(`DELETE FROM thoughts WHERE id = $1`, [thoughtId]); }
    catch { /* best-effort */ }
    finally { c.release(); }
  }
  return { deleted: key };
}

export interface DeleteApplicationResult {
  folder_prefix: string;
  files_deleted: number;
  thoughts_deleted: number;
  apps_deleted: number;
}

export async function deleteApplicationCore(
  pool: unknown,
  folderPrefix: string,
): Promise<DeleteApplicationResult | null> {
  const prefix = folderPrefix.endsWith("/") ? folderPrefix : folderPrefix + "/";
  const client = await (pool as any).connect();
  let filesDeleted = 0, thoughtsDeleted = 0, appsDeleted = 0;
  try {
    const appRows = await client.queryObject(
      `SELECT id, jd_thought_id, notes_thought_id FROM js_applications WHERE folder_prefix = $1`,
      [prefix],
    );
    if ((appRows.rows as any[]).length === 0) return null;

    const appThoughtIds: bigint[] = (appRows.rows as any[])
      .flatMap((r: any) => [r.jd_thought_id, r.notes_thought_id])
      .filter(Boolean);

    const filesResult = await client.queryObject(
      `DELETE FROM js_files WHERE storage_key LIKE $1 RETURNING storage_key, thought_id`,
      [prefix + "%"],
    );
    const fileRows = filesResult.rows as any[];
    filesDeleted = fileRows.length;
    const fileThoughtIds: bigint[] = fileRows.map((r: any) => r.thought_id).filter(Boolean);
    const s3Keys: string[] = fileRows.map((r: any) => r.storage_key);

    const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }));
    const s3Extra = (listed.Contents ?? [])
      .map((o: any) => o.Key as string)
      .filter((k: string) => !s3Keys.includes(k));
    for (const key of [...s3Keys, ...s3Extra]) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    }

    const allThoughtIds = [...new Set([...fileThoughtIds, ...appThoughtIds])];
    for (const tid of allThoughtIds) {
      try {
        await client.queryObject(`DELETE FROM thoughts WHERE id = $1`, [tid]);
        thoughtsDeleted++;
      } catch { /* best-effort */ }
    }

    const del = await client.queryObject(
      `DELETE FROM js_applications WHERE folder_prefix = $1`, [prefix],
    );
    appsDeleted = (del as any).rowCount ?? 0;
  } finally { client.release(); }

  return { folder_prefix: prefix, files_deleted: filesDeleted, thoughts_deleted: thoughtsDeleted, apps_deleted: appsDeleted };
}

// ===========================================================================
// FILE TOOLS
// ===========================================================================

export function registerUploadFileTool(
  server: unknown,
  pool: unknown,
  captureThoughtFn?: CaptureThoughtFn,
  chunkContentFn?: ChunkContentFn,
) {
  (server as any).tool(
    "upload_file",
    "Upload a file to the object store and record it in OB1. " +
    "Text files (text/markdown, text/plain, application/json) are also captured as semantic thoughts " +
    "and chunked at H2 boundaries for section-level retrieval via search_chunks_semantic.",
    {
      key: z.string().describe("Object store key, e.g. 'applications/2026-05-15-co-role/notes.md'"),
      content: z.string().describe("File content (text) or base64-encoded bytes for binary files"),
      content_type: z.string().default("text/markdown"),
      binary: z.boolean().default(false).describe("Set true and base64-encode content for PDFs/binaries"),
    },
    async (args: { key: string; content: string; content_type: string; binary: boolean }) => {
      const result = await uploadFileCore(pool, captureThoughtFn, args, chunkContentFn);
      return { content: [{ type: "text", text: `Uploaded: ${result.key} (${result.bytes} bytes)` }] };
    },
  );
}

export function registerGetFileTool(server: unknown) {
  (server as any).tool(
    "get_file",
    "Read a file from the object store. Returns text content directly; binary files return base64.",
    { key: z.string().describe("Object store key") },
    async ({ key }: { key: string }) => {
      const { bytes, contentType } = await getFileCore(key);
      if (isTextType(contentType)) {
        return { content: [{ type: "text", text: new TextDecoder().decode(bytes) }] };
      }
      const b64 = btoa(String.fromCharCode(...bytes));
      return { content: [{ type: "text", text: b64 }], _binary: true, _contentType: contentType };
    },
  );
}

export function registerGetFileUrlTool(server: unknown) {
  (server as any).tool(
    "get_file_url",
    "Generate a presigned URL for a file (valid for `expires_in` seconds, default 3600).",
    {
      key: z.string(),
      expires_in: z.number().int().min(60).max(86400).default(3600),
    },
    async ({ key, expires_in }: { key: string; expires_in: number }) => {
      const { url } = await getFileUrlCore(key, expires_in);
      return { content: [{ type: "text", text: url }] };
    },
  );
}

export function registerListFilesTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "list_files",
    "List files stored under a given prefix (like a folder listing).",
    { prefix: z.string().describe("Key prefix, e.g. 'applications/2026-05-15-co-role/'") },
    async ({ prefix }: { prefix: string }) => {
      const files = await listFilesCore(pool, prefix);
      return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] };
    },
  );
}

export function registerDeleteFileTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "delete_file",
    "Delete a file from the object store and remove its js_files record.",
    { key: z.string() },
    async ({ key }: { key: string }) => {
      const { deleted } = await deleteFileCore(pool, key);
      return { content: [{ type: "text", text: `Deleted: ${deleted}` }] };
    },
  );
}

export function registerDeleteApplicationTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "delete_application",
    "Fully delete an application: removes all object store files, js_files records, thoughts, interviews, and the js_applications row(s).",
    { folder_prefix: z.string().describe("Object store folder prefix, e.g. 'applications/2026-01-01-co-role/'") },
    async ({ folder_prefix }: { folder_prefix: string }) => {
      const result = await deleteApplicationCore(pool, folder_prefix);
      if (!result) {
        return { content: [{ type: "text", text: `No application found with folder_prefix ${folder_prefix}` }] };
      }
      return {
        content: [{
          type: "text",
          text: `Deleted application ${result.folder_prefix}: ${result.apps_deleted} app row(s), ${result.files_deleted} files, ${result.thoughts_deleted} thoughts removed.`,
        }],
      };
    },
  );
}

// ===========================================================================
// STATE CORE FUNCTIONS
// ===========================================================================

export interface PipelineFilters {
  status?: string;
  statuses?: string[];
  company?: string;
  role?: string;
  profile?: string;
  priority?: number;
  min_priority?: number;
  due_before?: string;
  limit?: number;
}

export async function getPipelineCore(pool: unknown, filters: PipelineFilters = {}): Promise<unknown[]> {
  const { status, statuses, company, role, profile, priority, min_priority, due_before, limit = 50 } = filters;
  const client = await (pool as any).connect();
  try {
    const where: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    const allStatuses = Array.from(new Set([
      ...(status ? [status] : []),
      ...(statuses ?? []),
    ]));
    if (allStatuses.length === 1) { where.push(`a.status = $${p++}`); params.push(allStatuses[0]); }
    else if (allStatuses.length > 1) { where.push(`a.status = ANY($${p++})`); params.push(allStatuses); }

    if (company) { where.push(`LOWER(COALESCE(c.name, a.company_name_raw)) LIKE '%' || LOWER($${p++}) || '%'`); params.push(company); }
    if (role) { where.push(`LOWER(a.role_title) LIKE '%' || LOWER($${p++}) || '%'`); params.push(role); }
    if (profile) { where.push(`p.slug = $${p++}`); params.push(profile); }
    if (priority) { where.push(`a.priority = $${p++}`); params.push(priority); }
    if (min_priority) { where.push(`a.priority >= $${p++}`); params.push(min_priority); }
    if (due_before) { where.push(`a.follow_up_date <= $${p++}`); params.push(due_before); }
    params.push(limit);

    const sql = `
      SELECT a.id, COALESCE(c.name, a.company_name_raw) AS company,
             a.role_title, p.slug AS profile, a.status, a.status_detail,
             a.applied_date, a.follow_up_date, a.priority, a.folder_prefix,
             a.resume_key, a.created_at
      FROM js_applications a
      LEFT JOIN js_companies c ON a.company_id = c.id
      LEFT JOIN js_profiles p ON a.profile_id = p.id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY a.priority DESC, a.follow_up_date ASC NULLS LAST, a.created_at DESC
      LIMIT $${p}`;

    const { rows } = await client.queryObject(sql, params);
    return rows as unknown[];
  } finally { client.release(); }
}

// Separators recognized when surrounded by spaces (avoids splitting on hyphens within names)
const SEPARATOR_RE = / (?:·|\||—|-|:) /;

export async function getApplicationCore(pool: unknown, identifier: string): Promise<unknown[]> {
  const client = await (pool as any).connect();
  try {
    const isUuid = /^[0-9a-f-]{36}$/.test(identifier);

    if (isUuid) {
      const { rows } = await client.queryObject(
        `SELECT a.id::text AS id, a.company_name_raw, a.role_title, a.folder_prefix,
                a.source_url, a.status, a.status_detail, a.applied_date, a.follow_up_date,
                a.priority, a.resume_key, a.created_at, a.updated_at,
                a.jd_thought_id::text AS jd_thought_id,
                a.notes_thought_id::text AS notes_thought_id,
                COALESCE(c.name, a.company_name_raw) AS company_name,
                c.industry, c.remote_policy, p.slug AS profile_slug, p.display_name AS profile_name
         FROM js_applications a
         LEFT JOIN js_companies c ON a.company_id = c.id
         LEFT JOIN js_profiles p ON a.profile_id = p.id
         WHERE a.id = $1::uuid`,
        [identifier],
      );
      if (!rows.length) return [];
      const app = rows[0] as any;
      const { rows: files } = await client.queryObject(
        "SELECT storage_key, content_type, file_size FROM js_files WHERE storage_key LIKE $1 ORDER BY storage_key",
        [((app.folder_prefix ?? "") + "%")],
      );
      const { rows: interviews } = await client.queryObject(
        "SELECT stage, scheduled_at, completed_at, rating FROM js_interviews WHERE application_id = $1 ORDER BY created_at",
        [app.id],
      );
      return [{ ...app, files, interviews }];
    }

    // Text search: parse optional company · role separator
    const sepMatch = SEPARATOR_RE.exec(identifier);
    const where: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (sepMatch) {
      const company = identifier.slice(0, sepMatch.index).trim();
      const role = identifier.slice(sepMatch.index + sepMatch[0].length).trim();
      where.push(`LOWER(COALESCE(c.name, a.company_name_raw)) LIKE '%' || LOWER($${p++}) || '%'`);
      params.push(company);
      where.push(`LOWER(a.role_title) LIKE '%' || LOWER($${p++}) || '%'`);
      params.push(role);
    } else {
      where.push(
        `(LOWER(COALESCE(c.name, a.company_name_raw)) LIKE '%' || LOWER($${p}) || '%' OR LOWER(a.role_title) LIKE '%' || LOWER($${p}) || '%')`,
      );
      params.push(identifier);
      p++;
    }

    params.push(50);
    const { rows } = await client.queryObject(
      `SELECT a.id::text AS id, a.company_name_raw, a.role_title, a.folder_prefix,
              a.source_url, a.status, a.status_detail, a.applied_date, a.follow_up_date,
              a.priority, a.resume_key, a.created_at, a.updated_at,
              a.jd_thought_id::text AS jd_thought_id,
              a.notes_thought_id::text AS notes_thought_id,
              COALESCE(c.name, a.company_name_raw) AS company_name,
              c.industry, c.remote_policy, p.slug AS profile_slug, p.display_name AS profile_name
       FROM js_applications a
       LEFT JOIN js_companies c ON a.company_id = c.id
       LEFT JOIN js_profiles p ON a.profile_id = p.id
       WHERE ${where.join(" AND ")}
       ORDER BY a.priority DESC, a.follow_up_date ASC NULLS LAST, a.created_at DESC
       LIMIT $${p}`,
      params,
    );
    return rows as unknown[];
  } finally { client.release(); }
}

export async function getProfilesCore(pool: unknown): Promise<unknown[]> {
  const client = await (pool as any).connect();
  try {
    const { rows } = await client.queryObject(
      `SELECT id, slug, display_name, created_at, updated_at FROM js_profiles ORDER BY slug`,
    );
    return rows as unknown[];
  } finally { client.release(); }
}

export async function deleteProfileCore(pool: unknown, id: string): Promise<boolean> {
  const client = await (pool as any).connect();
  try {
    const { rowCount } = await client.queryObject(
      `DELETE FROM js_profiles WHERE id = $1`, [id],
    );
    return (rowCount ?? 0) > 0;
  } finally { client.release(); }
}

export interface UpsertProfileArgs {
  slug: string;
  display_name: string;
  jd_signal_keywords?: string[];
  avoid_when?: string;
  search_query?: string;
  active?: boolean;
}

export async function upsertProfileCore(
  pool: unknown,
  args: UpsertProfileArgs,
): Promise<{ id: string; slug: string }> {
  const client = await (pool as any).connect();
  try {
    const { rows } = await client.queryObject(
      `INSERT INTO js_profiles (slug, display_name, jd_signal_keywords, avoid_when, search_query, active)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, true))
       ON CONFLICT (slug) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         jd_signal_keywords = COALESCE(EXCLUDED.jd_signal_keywords, js_profiles.jd_signal_keywords),
         avoid_when = COALESCE(EXCLUDED.avoid_when, js_profiles.avoid_when),
         search_query = COALESCE(EXCLUDED.search_query, js_profiles.search_query),
         active = EXCLUDED.active,
         updated_at = now()
       RETURNING id, slug`,
      [args.slug, args.display_name, args.jd_signal_keywords ?? null,
       args.avoid_when ?? null, args.search_query ?? null, args.active ?? null],
    );
    return { id: (rows[0] as any).id, slug: (rows[0] as any).slug };
  } finally { client.release(); }
}

export async function getOverdueFollowupsCore(pool: unknown): Promise<unknown[]> {
  const client = await (pool as any).connect();
  try {
    const { rows } = await client.queryObject(
      `SELECT a.id, COALESCE(c.name, a.company_name_raw) AS company,
              a.role_title, a.status, a.follow_up_date,
              (now()::date - a.follow_up_date) AS days_overdue
       FROM js_applications a
       LEFT JOIN js_companies c ON a.company_id = c.id
       WHERE a.follow_up_date <= now()::date
         AND a.status NOT IN ('closed', 'offer')
       ORDER BY a.follow_up_date ASC`,
    );
    return rows as unknown[];
  } finally { client.release(); }
}

export interface CreateApplicationArgs {
  company_name: string;
  role_title: string;
  folder_prefix: string;
  profile_slug?: string;
  source_url?: string;
  status: string;
  priority: number;
  status_detail?: string;
}

export async function createApplicationCore(
  pool: unknown,
  args: CreateApplicationArgs,
): Promise<{ id: string; company: string; role: string }> {
  const client = await (pool as any).connect();
  try {
    const { rows: co } = await client.queryObject<{ id: string }>(
      "SELECT id FROM js_companies WHERE LOWER(name) = LOWER($1) OR slug = LOWER($1) LIMIT 1",
      [args.company_name],
    );
    const companyId = co[0]?.id ?? null;

    let profileId: string | null = null;
    if (args.profile_slug) {
      const { rows: pr } = await client.queryObject<{ id: string }>(
        "SELECT id FROM js_profiles WHERE slug = $1 LIMIT 1",
        [args.profile_slug],
      );
      profileId = pr[0]?.id ?? null;
    }

    const { rows } = await client.queryObject<{ id: string }>(
      `INSERT INTO js_applications
         (company_id, company_name_raw, role_title, profile_id, folder_prefix,
          source_url, status, status_detail, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id::text AS id`,
      [companyId, args.company_name, args.role_title, profileId, args.folder_prefix,
       args.source_url ?? null, args.status, args.status_detail ?? null, args.priority],
    );
    return { id: rows[0].id, company: args.company_name, role: args.role_title };
  } finally { client.release(); }
}

export interface UpdateApplicationStatusArgs {
  id: string;
  status: string;
  status_detail?: string;
  follow_up_date?: string;
  applied_date?: string;
}

export async function updateApplicationStatusCore(
  pool: unknown,
  args: UpdateApplicationStatusArgs,
): Promise<{ id: string; status: string; follow_up_date?: string } | null> {
  const client = await (pool as any).connect();
  try {
    const fup = args.follow_up_date ?? (args.status === "applied"
      ? new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
      : undefined);

    const sets: string[] = ["status = $2", "updated_at = now()"];
    const params: unknown[] = [args.id, args.status];
    let p = 3;
    if (args.status_detail !== undefined) { sets.push(`status_detail = $${p++}`); params.push(args.status_detail); }
    if (fup !== undefined) { sets.push(`follow_up_date = $${p++}`); params.push(fup); }
    if (args.applied_date !== undefined) { sets.push(`applied_date = $${p++}`); params.push(args.applied_date); }
    else if (args.status === "applied") { sets.push(`applied_date = COALESCE(applied_date, now()::date)`); }

    const { rowCount } = await client.queryObject(
      `UPDATE js_applications SET ${sets.join(", ")} WHERE id = $1`, params,
    );
    if (!rowCount) return null;
    return { id: args.id, status: args.status, follow_up_date: fup };
  } finally { client.release(); }
}

export interface LogInterviewArgs {
  application_id: string;
  stage: string;
  scheduled_at?: string;
  interviewer_name?: string;
  interviewer_title?: string;
  pre_notes?: string;
}

export async function logInterviewCore(
  pool: unknown,
  args: LogInterviewArgs,
): Promise<{ id: string; stage: string }> {
  const client = await (pool as any).connect();
  try {
    const { rows } = await client.queryObject(
      `INSERT INTO js_interviews (application_id, stage, scheduled_at, interviewer_name, interviewer_title, pre_notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [args.application_id, args.stage, args.scheduled_at ?? null,
       args.interviewer_name ?? null, args.interviewer_title ?? null, args.pre_notes ?? null],
    );
    await client.queryObject(
      "UPDATE js_applications SET status = 'interview-scheduled', updated_at = now() WHERE id = $1 AND status NOT IN ('interviewed','offer','closed')",
      [args.application_id],
    );
    return { id: (rows[0] as any).id, stage: args.stage };
  } finally { client.release(); }
}

export async function completeInterviewCore(
  pool: unknown,
  args: { interview_id: string; post_notes: string; rating?: number },
): Promise<{ interview_id: string } | null> {
  const client = await (pool as any).connect();
  try {
    const { rows } = await client.queryObject(
      `UPDATE js_interviews SET post_notes = $2, rating = $3, completed_at = now(), updated_at = now()
       WHERE id = $1 RETURNING application_id`,
      [args.interview_id, args.post_notes, args.rating ?? null],
    );
    if (!rows.length) return null;
    await client.queryObject(
      "UPDATE js_applications SET status = 'interviewed', updated_at = now() WHERE id = $1",
      [(rows[0] as any).application_id],
    );
    return { interview_id: args.interview_id };
  } finally { client.release(); }
}

export interface AddContactArgs {
  name: string;
  company_name?: string;
  title?: string;
  email?: string;
  linkedin_url?: string;
  relationship_type: string;
  notes?: string;
}

export async function addContactCore(
  pool: unknown,
  args: AddContactArgs,
): Promise<{ id: string; name: string }> {
  const client = await (pool as any).connect();
  try {
    let companyId: string | null = null;
    if (args.company_name) {
      const { rows } = await client.queryObject(
        "SELECT id FROM js_companies WHERE LOWER(name) = LOWER($1) LIMIT 1",
        [args.company_name],
      );
      companyId = (rows[0] as any)?.id ?? null;
    }
    const { rows } = await client.queryObject(
      `INSERT INTO js_contacts (name, company_id, title, email, linkedin_url, relationship_type, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [args.name, companyId, args.title ?? null, args.email ?? null,
       args.linkedin_url ?? null, args.relationship_type, args.notes ?? null],
    );
    return { id: (rows[0] as any).id, name: args.name };
  } finally { client.release(); }
}

export interface UpsertCompanyArgs {
  name: string;
  slug: string;
  industry?: string;
  size_range?: string;
  remote_policy?: string;
  website?: string;
  domain_tags?: string[];
  notes?: string;
}

export async function upsertCompanyCore(
  pool: unknown,
  args: UpsertCompanyArgs,
): Promise<{ id: string; name: string }> {
  const client = await (pool as any).connect();
  try {
    const { rows } = await client.queryObject(
      `INSERT INTO js_companies (name, slug, industry, size_range, remote_policy, website, domain_tags, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         industry = COALESCE(EXCLUDED.industry, js_companies.industry),
         size_range = COALESCE(EXCLUDED.size_range, js_companies.size_range),
         remote_policy = COALESCE(EXCLUDED.remote_policy, js_companies.remote_policy),
         website = COALESCE(EXCLUDED.website, js_companies.website),
         domain_tags = COALESCE(EXCLUDED.domain_tags, js_companies.domain_tags),
         notes = COALESCE(EXCLUDED.notes, js_companies.notes),
         updated_at = now()
       RETURNING id`,
      [args.name, args.slug, args.industry ?? null, args.size_range ?? null,
       args.remote_policy ?? null, args.website ?? null,
       args.domain_tags ?? null, args.notes ?? null],
    );
    return { id: (rows[0] as any).id, name: args.name };
  } finally { client.release(); }
}

export interface LogSearchRunArgs {
  profile_slug: string;
  query: string;
  pages_fetched: number;
  total_results: number;
  new_after_dedup: number;
  screened: number;
  fit_count: number;
  summary_key?: string;
}

export async function logSearchRunCore(pool: unknown, args: LogSearchRunArgs): Promise<string> {
  const client = await (pool as any).connect();
  try {
    const { rows: pRows } = await client.queryObject(
      "SELECT id FROM js_profiles WHERE slug = $1", [args.profile_slug],
    );
    const profileId = (pRows[0] as any)?.id ?? null;
    const { rows } = await client.queryObject(
      `INSERT INTO js_search_runs
         (profile_id, query, pages_fetched, total_results, new_after_dedup, screened, fit_count, summary_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [profileId, args.query, args.pages_fetched, args.total_results,
       args.new_after_dedup, args.screened, args.fit_count, args.summary_key ?? null],
    );
    return (rows[0] as any).id as string;
  } finally { client.release(); }
}

export interface GetSearchRunsArgs {
  profile_slug?: string | null;
  since?: string | null;
  limit: number;
}

export interface SearchRunRow {
  id: string;
  profile_slug: string | null;
  query: string;
  pages_fetched: number;
  total_results: number;
  new_after_dedup: number;
  screened: number;
  fit_count: number;
  fetch_failed_count: number;
  summary_key: string | null;
  run_at: string;
}

export async function getSearchRunsCore(pool: unknown, args: GetSearchRunsArgs): Promise<SearchRunRow[]> {
  const { profile_slug, since, limit } = args;
  const client = await (pool as any).connect();
  try {
    const where: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    if (profile_slug) { where.push(`p.slug = $${p++}`); params.push(profile_slug); }
    if (since) { where.push(`sr.run_at >= $${p++}::timestamptz`); params.push(since); }
    params.push(limit);

    const { rows } = await client.queryObject(
      `SELECT sr.id,
              p.slug        AS profile_slug,
              sr.query,
              sr.pages_fetched,
              sr.total_results,
              sr.new_after_dedup,
              sr.screened,
              sr.fit_count,
              COALESCE((
                SELECT COUNT(*)::int
                FROM js_ingested_positions ip
                WHERE ip.search_run_id = sr.id AND ip.outcome = 'fetch-failed'
              ), 0) AS fetch_failed_count,
              sr.summary_key,
              sr.run_at
       FROM js_search_runs sr
       LEFT JOIN js_profiles p ON sr.profile_id = p.id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY sr.run_at DESC
       LIMIT $${p}`,
      params,
    );
    return rows as SearchRunRow[];
  } finally { client.release(); }
}

export function registerGetSearchRunsTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "get_search_runs",
    "List search run summaries from js_search_runs with computed fetch_failed_count. " +
    "Filters: profile_slug, since (ISO date), limit. Ordered run_at DESC.",
    {
      profile_slug: z.string().nullish().describe("Filter to a specific profile slug"),
      since: z.string().nullish().describe("ISO date/timestamp — only runs at or after this time"),
      limit: z.number().int().min(1).max(200).default(20),
    },
    async (args: GetSearchRunsArgs) => {
      const rows = await getSearchRunsCore(pool, args);
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    },
  );
}

export async function searchApplicationsSemanticCore(
  searchThoughtsFn: SearchThoughtsFn | undefined,
  query: string,
  limit: number,
): Promise<Array<{ content: string; similarity: number; metadata: Record<string, unknown> }> | null> {
  if (!searchThoughtsFn) return null;
  const results = await searchThoughtsFn(query, limit, { source: "job-search-mcp" });
  return results.map(r => ({ content: r.content, similarity: r.similarity, metadata: r.metadata }));
}

// ===========================================================================
// STATE TOOLS
// ===========================================================================

export function registerGetPipelineTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "get_pipeline",
    "List applications with optional filters. Returns pipeline state from js_applications.",
    {
      status: z.string().optional().describe("Filter by a single status, e.g. 'applied' (use statuses[] for multi)"),
      statuses: z.array(z.string()).optional().describe("Filter by multiple statuses (OR)"),
      company: z.string().optional(),
      role: z.string().optional(),
      profile: z.string().optional(),
      priority: z.number().int().min(1).max(3).optional(),
      min_priority: z.number().int().min(1).max(3).optional(),
      due_before: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    },
    async (filters: PipelineFilters) => {
      const rows = await getPipelineCore(pool, filters);
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    },
  );
}

export function registerGetApplicationTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "get_application",
    "Get application record(s) matching a company name, role title, 'Company · Role Title' combo, or UUID. Returns all matches — disambiguate with a UUID when multiple results are returned.",
    { identifier: z.string().describe("Company name, role title, 'Company · Role Title' (any space-surrounded separator OK, partial matches OK), or application UUID") },
    async ({ identifier }: { identifier: string }) => {
      const results = await getApplicationCore(pool, identifier);
      if (!results.length) return { content: [{ type: "text", text: `No application found matching: ${identifier}` }] };
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    },
  );
}

export function registerUpdateApplicationStatusTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "update_application_status",
    "Atomically update the status of an application. Also sets follow_up_date if not provided (applied → +14 days).",
    {
      id: z.string().describe("Application UUID"),
      status: z.string(),
      status_detail: z.string().optional(),
      follow_up_date: z.string().optional().describe("ISO date for next follow-up"),
      applied_date: z.string().optional().describe("ISO date when submitted"),
    },
    async (args: UpdateApplicationStatusArgs) => {
      const result = await updateApplicationStatusCore(pool, args);
      if (!result) return { content: [{ type: "text", text: `Application not found: ${args.id}` }] };
      return {
        content: [{
          type: "text",
          text: `Updated ${result.id} → ${result.status}${result.follow_up_date ? ` (follow-up: ${result.follow_up_date})` : ""}`,
        }],
      };
    },
  );
}

export function registerLogInterviewTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "log_interview",
    "Record a new interview for an application. Updates application status to 'interview-scheduled'.",
    {
      application_id: z.string(),
      stage: z.string().describe("e.g. 'recruiter-screen', 'hiring-manager', 'technical', 'panel'"),
      scheduled_at: z.string().optional().describe("ISO datetime"),
      interviewer_name: z.string().optional(),
      interviewer_title: z.string().optional(),
      pre_notes: z.string().optional().describe("Preparation notes"),
    },
    async (args: LogInterviewArgs) => {
      const result = await logInterviewCore(pool, args);
      return { content: [{ type: "text", text: `Interview logged: ${result.id} (${result.stage})` }] };
    },
  );
}

export function registerCompleteInterviewTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "complete_interview",
    "Record post-interview debrief notes and rating. Updates application status to 'interviewed'.",
    {
      interview_id: z.string(),
      post_notes: z.string().describe("Debrief notes after the call"),
      rating: z.number().int().min(1).max(5).optional().describe("Self-assessment 1-5"),
    },
    async (args: { interview_id: string; post_notes: string; rating?: number }) => {
      const result = await completeInterviewCore(pool, args);
      if (!result) return { content: [{ type: "text", text: `Interview not found: ${args.interview_id}` }] };
      return { content: [{ type: "text", text: `Interview ${result.interview_id} completed. Debrief saved.` }] };
    },
  );
}

export function registerGetOverdueFollowupsTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "get_overdue_followups",
    "List applications where follow_up_date is today or earlier and status is still active.",
    {},
    async () => {
      const rows = await getOverdueFollowupsCore(pool);
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    },
  );
}

export function registerAddContactTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "add_contact",
    "Add a recruiter, hiring manager, or warm connection to the contacts table.",
    {
      name: z.string(),
      company_name: z.string().optional(),
      title: z.string().optional(),
      email: z.string().optional(),
      linkedin_url: z.string().optional(),
      relationship_type: z.enum(["recruiter", "hiring-manager", "warm-connection", "network"]).default("network"),
      notes: z.string().optional(),
    },
    async (args: AddContactArgs) => {
      const result = await addContactCore(pool, args);
      return { content: [{ type: "text", text: `Contact added: ${result.name} (${result.id})` }] };
    },
  );
}

export function registerGetContactsTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "get_contacts",
    "List contacts, optionally filtered by company name.",
    { company: z.string().optional() },
    async ({ company }: { company?: string }) => {
      const client = await (pool as any).connect();
      try {
        const { rows } = await client.queryObject(
          `SELECT ct.name, ct.title, ct.relationship_type, ct.email, ct.linkedin_url,
                  ct.notes, ct.last_contact_at, ct.follow_up_date,
                  COALESCE(c.name, '') AS company_name
           FROM js_contacts ct
           LEFT JOIN js_companies c ON ct.company_id = c.id
           ${company ? "WHERE LOWER(c.name) LIKE LOWER($1)" : ""}
           ORDER BY ct.last_contact_at DESC NULLS LAST`,
          company ? [`%${company}%`] : [],
        );
        return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
      } finally { client.release(); }
    },
  );
}

export function registerUpsertCompanyTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "upsert_company",
    "Create or update a company record. Called automatically during JD processing.",
    {
      name: z.string(),
      slug: z.string().describe("URL-safe identifier, e.g. 'middesk'"),
      industry: z.string().optional(),
      size_range: z.enum(["startup", "mid-market", "enterprise", "public"]).optional(),
      remote_policy: z.string().optional(),
      website: z.string().optional(),
      domain_tags: z.array(z.string()).optional(),
      notes: z.string().optional(),
    },
    async (args: UpsertCompanyArgs) => {
      const result = await upsertCompanyCore(pool, args);
      return { content: [{ type: "text", text: `Company: ${result.name} (${result.id})` }] };
    },
  );
}

export function registerUpsertProfileTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "upsert_profile",
    "Create or update a profile record in js_profiles. Use when adding a new search profile or updating an existing one.",
    {
      slug: z.string().describe("URL-safe identifier, e.g. 'vendor-gtm'"),
      display_name: z.string().describe("Human-readable profile name"),
      jd_signal_keywords: z.array(z.string()).optional().describe("Keywords that signal a JD matches this profile"),
      avoid_when: z.string().optional().describe("Conditions where this profile should not be used"),
      search_query: z.string().optional().describe("OR-query used by /ingest for Google Jobs search"),
      active: z.boolean().optional().describe("Whether this profile is active (default true)"),
    },
    async (args: UpsertProfileArgs) => {
      const result = await upsertProfileCore(pool, args);
      return { content: [{ type: "text", text: `Profile: ${result.slug} (${result.id})` }] };
    },
  );
}

export function registerLogSearchRunTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "log_search_run",
    "Record a /ingest search run in the audit log.",
    {
      profile_slug: z.string(),
      query: z.string(),
      pages_fetched: z.number().int(),
      total_results: z.number().int(),
      new_after_dedup: z.number().int(),
      screened: z.number().int(),
      fit_count: z.number().int(),
      summary_key: z.string().optional().describe("Object store key for the summary .md file"),
    },
    async (args: LogSearchRunArgs) => {
      const id = await logSearchRunCore(pool, args);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ id, profile_slug: args.profile_slug, fit_count: args.fit_count, total_results: args.total_results }),
        }],
      };
    },
  );
}

export function registerSearchApplicationsSemanticTool(server: unknown, pool: unknown, searchThoughtsFn?: SearchThoughtsFn) {
  (server as any).tool(
    "search_applications_semantic",
    "Semantic search across all application notes, JDs, and research using pgvector.",
    {
      query: z.string().describe("Natural language query, e.g. 'AI governance domain fit'"),
      limit: z.number().int().min(1).max(20).default(5),
    },
    async ({ query, limit }: { query: string; limit: number }) => {
      const results = await searchApplicationsSemanticCore(searchThoughtsFn, query, limit);
      if (results === null) {
        return { content: [{ type: "text", text: "search_applications_semantic: searchThoughts callback not configured" }] };
      }
      if (!results.length) {
        return { content: [{ type: "text", text: `No application content found matching "${query}".` }] };
      }
      const formatted = results.map((r, i) =>
        `--- ${i + 1} (${(r.similarity * 100).toFixed(1)}% match) ---\n${r.content}`
      ).join("\n\n");
      return { content: [{ type: "text", text: formatted }] };
    },
  );
}

export function registerCreateApplicationTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "create_application",
    "Create a new job application record in the pipeline. Returns the new application UUID for use with update_application_status and log_interview.",
    {
      company_name: z.string().describe("Company name — looked up in js_companies; stored as company_name_raw if not found"),
      role_title: z.string(),
      folder_prefix: z.string().describe("Object store folder prefix, e.g. 'applications/2026-05-27-co-role/'"),
      profile_slug: z.string().optional().describe("Profile slug, e.g. 'ai-governance-se' — looked up in js_profiles"),
      source_url: z.string().optional(),
      status: z.string().default("resume-ready").describe("Initial status, e.g. 'resume-ready', 'applied', 'pending-review'"),
      priority: z.number().int().min(1).max(3).default(1),
      status_detail: z.string().optional(),
    },
    async (args: CreateApplicationArgs) => {
      const result = await createApplicationCore(pool, args);
      return {
        content: [{
          type: "text",
          text: `Application created: ${result.company} / ${result.role} → ${result.id}`,
        }],
      };
    },
  );
}

// ===========================================================================
// STRUCTURED METADATA TOOLS (Phase 3)
// update_application_fields — store domain_connection, domain_tags, jd_requirements
// find_similar_applications — cross-app semantic pattern matching via Phase-2 chunk embeddings
// ===========================================================================

export interface UpdateApplicationFieldsArgs {
  id: string;
  domain_connection?: string;
  domain_tags?: string[];
  jd_requirements?: { required: string[]; preferred: string[] };
}

export async function updateApplicationFieldsCore(
  pool: unknown,
  args: UpdateApplicationFieldsArgs,
): Promise<{ id: string } | null> {
  const sets: string[] = [];
  const params: unknown[] = [args.id];
  let p = 2;
  if (args.domain_connection !== undefined) { sets.push(`domain_connection = $${p++}`); params.push(args.domain_connection); }
  if (args.domain_tags !== undefined)       { sets.push(`domain_tags = $${p++}::text[]`); params.push(args.domain_tags); }
  if (args.jd_requirements !== undefined)  { sets.push(`jd_requirements = $${p++}::jsonb`); params.push(JSON.stringify(args.jd_requirements)); }
  if (sets.length === 0) return null;
  const client = await (pool as any).connect();
  try {
    const { rows } = await client.queryObject(
      `UPDATE js_applications SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $1::uuid RETURNING id::text AS id`,
      params,
    );
    return (rows[0] as any) ?? null;
  } finally { client.release(); }
}

export function registerUpdateApplicationFieldsTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "update_application_fields",
    "Store structured metadata on an application: domain_connection (one sentence connecting applicant experience " +
    "to this company's domain), domain_tags (2-4 short tags), jd_requirements (required + preferred arrays). " +
    "Called by process-jd (domain_tags, jd_requirements) and create-application (domain_connection).",
    {
      id: z.string().describe("Application UUID"),
      domain_connection: z.string().optional().describe("One-sentence applicant-to-domain connection summary"),
      domain_tags: z.array(z.string()).optional().describe("2-4 short domain tags, e.g. ['ai-governance','b2b-saas']"),
      jd_requirements: z.object({
        required: z.array(z.string()),
        preferred: z.array(z.string()),
      }).optional().describe("Structured requirements from the JD"),
    },
    async (args: UpdateApplicationFieldsArgs) => {
      const result = await updateApplicationFieldsCore(pool, args);
      if (!result) return { content: [{ type: "text", text: "No fields to update or application not found." }] };
      return { content: [{ type: "text", text: `Application ${result.id} fields updated.` }] };
    },
  );
}

export interface SimilarApplicationResult {
  id: string;
  company_name: string;
  role_title: string;
  domain_connection: string | null;
  domain_tags: string[] | null;
  status: string;
  similarity: number;
}

export async function findSimilarApplicationsCore(
  pool: unknown,
  embedQueryFn: EmbedQueryFn | undefined,
  args: { query: string; exclude_id?: string; limit?: number },
): Promise<SimilarApplicationResult[] | null> {
  if (!embedQueryFn) return null;
  const { query, exclude_id, limit = 5 } = args;
  const embedding = await embedQueryFn(query);
  const embeddingLiteral = `[${embedding.join(",")}]`;
  const client = await (pool as any).connect();
  try {
    // DISTINCT ON picks the best-matching chunk per application, then the outer
    // query re-sorts and limits — uses Phase 2 chunk embeddings for notes.md sections.
    const { rows } = await client.queryObject(
      `SELECT * FROM (
         SELECT DISTINCT ON (a.id)
                a.id::text AS id,
                COALESCE(a.company_name_raw, co.name) AS company_name,
                a.role_title,
                a.domain_connection,
                a.domain_tags,
                a.status,
                (t.embedding <=> $1::vector) AS similarity
         FROM js_chunks ch
         JOIN thoughts t ON ch.thought_id = t.id
         JOIN js_applications a ON ch.storage_key = (a.folder_prefix || 'notes.md')
         LEFT JOIN js_companies co ON a.company_id = co.id
         WHERE ch.storage_key LIKE 'applications/%/notes.md'
           AND ($2::uuid IS NULL OR a.id != $2::uuid)
           AND (t.embedding <=> $1::vector) < 0.5
         ORDER BY a.id, (t.embedding <=> $1::vector) ASC
       ) per_app
       ORDER BY similarity ASC
       LIMIT $3`,
      [embeddingLiteral, exclude_id ?? null, limit],
    );
    return (rows as any[]).map((r: any) => ({
      id: r.id,
      company_name: r.company_name,
      role_title: r.role_title,
      domain_connection: r.domain_connection ?? null,
      domain_tags: r.domain_tags ?? null,
      status: r.status,
      similarity: Number(r.similarity),
    }));
  } finally { client.release(); }
}

export function registerFindSimilarApplicationsTool(server: unknown, pool: unknown, embedQueryFn?: EmbedQueryFn) {
  (server as any).tool(
    "find_similar_applications",
    "Semantic search across past applications by domain. Uses Phase-2 chunk embeddings from notes.md to find " +
    "applications where the business domain context is similar to the query. " +
    "Returns applications in OB1 mode only — no-op in local mode. " +
    "Use exclude_id to omit the current application from results.",
    {
      query: z.string().describe("Domain/context query, e.g. 'AI governance compliance enterprise SaaS'"),
      exclude_id: z.string().nullish().describe("Application UUID to exclude (the current application)"),
      limit: z.number().int().min(1).max(10).default(5),
    },
    async (args: { query: string; exclude_id?: string; limit: number }) => {
      const results = await findSimilarApplicationsCore(pool, embedQueryFn, args);
      if (results === null) {
        return { content: [{ type: "text", text: "find_similar_applications: embedQuery callback not configured" }] };
      }
      if (!results.length) {
        return { content: [{ type: "text", text: "No similar past applications found." }] };
      }
      const formatted = results.map((r, i) => [
        `--- ${i + 1} | ${r.company_name} — ${r.role_title} | ${r.status} (sim ${r.similarity.toFixed(3)}) ---`,
        r.domain_connection ? `Domain connection: ${r.domain_connection}` : "",
        r.domain_tags?.length ? `Tags: ${r.domain_tags.join(", ")}` : "",
      ].filter(Boolean).join("\n")).join("\n\n");
      return { content: [{ type: "text", text: formatted }] };
    },
  );
}

// ===========================================================================
// CHUNK SEARCH CORE FUNCTION (Phase 2)
// ===========================================================================

export interface ChunkSearchResult {
  storage_key: string;
  section_title: string | null;
  section_index: number;
  content: string;
  similarity: number;
}

export async function searchChunksSemanticCore(
  pool: unknown,
  embedQueryFn: EmbedQueryFn | undefined,
  args: { query: string; storage_key_prefix?: string; limit?: number },
): Promise<ChunkSearchResult[] | null> {
  if (!embedQueryFn) return null;
  const { query, storage_key_prefix, limit = 5 } = args;
  const embedding = await embedQueryFn(query);
  const embeddingLiteral = `[${embedding.join(",")}]`;
  const client = await (pool as any).connect();
  try {
    const { rows } = await client.queryObject(
      `SELECT c.storage_key, c.section_title, c.section_index, c.content,
              (t.embedding <=> $1::vector) AS similarity
       FROM js_chunks c
       JOIN thoughts t ON c.thought_id = t.id
       WHERE ($2::text IS NULL OR c.storage_key LIKE $2 || '%')
         AND (t.embedding <=> $1::vector) < 0.4
       ORDER BY similarity ASC
       LIMIT $3`,
      [embeddingLiteral, storage_key_prefix ?? null, limit],
    );
    return (rows as any[]).map((r: any) => ({
      storage_key: r.storage_key,
      section_title: r.section_title ?? null,
      section_index: Number(r.section_index),
      content: r.content,
      similarity: Number(r.similarity),
    }));
  } finally { client.release(); }
}

export function registerSearchChunksSemanticTool(server: unknown, pool: unknown, embedQueryFn?: EmbedQueryFn) {
  (server as any).tool(
    "search_chunks_semantic",
    "Semantic search across document sections (H2 chunks). Returns scored sections rather than whole files. " +
    "Use storage_key_prefix to scope to a folder (e.g. 'applications/2026-05-15-co-role/'). " +
    "Results filtered to similarity < 0.4 (cosine distance; lower = more similar).",
    {
      query: z.string().describe("Natural language query, e.g. 'domain connection fintech compliance'"),
      storage_key_prefix: z.string().nullish().describe(
        "Limit results to keys under this prefix, e.g. 'applications/2026-05-15-co-role/' or 'profiles/presales-se/'",
      ),
      limit: z.number().int().min(1).max(20).default(5),
    },
    async (args: { query: string; storage_key_prefix?: string; limit: number }) => {
      const results = await searchChunksSemanticCore(pool, embedQueryFn, args);
      if (results === null) {
        return { content: [{ type: "text", text: "search_chunks_semantic: embedQuery callback not configured" }] };
      }
      if (!results.length) {
        return { content: [{ type: "text", text: `No chunks found matching "${args.query}" (similarity threshold 0.4).` }] };
      }
      const formatted = results.map((r, i) => [
        `--- ${i + 1} | ${r.storage_key} § ${r.section_title ?? "(preamble)"} (sim ${r.similarity.toFixed(3)}) ---`,
        r.content,
      ].join("\n")).join("\n\n");
      return { content: [{ type: "text", text: formatted }] };
    },
  );
}

// ===========================================================================
// INGEST TRACKING CORE FUNCTIONS
// Replaces seen-jobs.json / linkedin-seen-jobs.json with structured Postgres storage.
// ===========================================================================

export interface CheckPositionSeenArgs {
  source_url?: string;
  company_name?: string;
  role_title?: string;
}

export interface CheckPositionSeenResult {
  seen: boolean;
  outcome?: string;
  is_repost?: boolean;
  last_seen_at?: string;
  first_seen_at?: string;
  source?: string; // 'ingest' | 'direct'
}

export async function checkPositionSeenCore(
  pool: unknown,
  args: CheckPositionSeenArgs,
): Promise<CheckPositionSeenResult> {
  const client = await (pool as any).connect();
  const REPOST_DAYS = 60;
  try {
    // Tier 1: URL exact match in js_ingested_positions
    if (args.source_url) {
      const { rows } = await client.queryObject(
        `SELECT outcome, is_repost, first_seen_at, created_at
         FROM js_ingested_positions WHERE source_url = $1
         ORDER BY created_at DESC LIMIT 1`,
        [args.source_url],
      );
      if ((rows as any[]).length > 0) {
        const r = rows[0] as any;
        const firstSeen: Date = r.first_seen_at ?? r.created_at;
        const daysSince = (Date.now() - new Date(firstSeen).getTime()) / 86400000;
        return {
          seen: true, outcome: r.outcome, source: "ingest",
          is_repost: daysSince > REPOST_DAYS,
          last_seen_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
          first_seen_at: firstSeen instanceof Date ? firstSeen.toISOString() : firstSeen,
        };
      }
    }

    if (args.company_name && args.role_title) {
      // Tier 2: Exact company+role in js_ingested_positions
      const { rows } = await client.queryObject(
        `SELECT outcome, first_seen_at, created_at
         FROM js_ingested_positions
         WHERE lower(company_name) = lower($1) AND lower(role_title) = lower($2)
         ORDER BY created_at DESC LIMIT 1`,
        [args.company_name, args.role_title],
      );
      if ((rows as any[]).length > 0) {
        const r = rows[0] as any;
        const firstSeen: Date = r.first_seen_at ?? r.created_at;
        const daysSince = (Date.now() - new Date(firstSeen).getTime()) / 86400000;
        return {
          seen: true, outcome: r.outcome, source: "ingest",
          is_repost: daysSince > REPOST_DAYS,
          last_seen_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
          first_seen_at: firstSeen instanceof Date ? firstSeen.toISOString() : firstSeen,
        };
      }

      // Tier 3: Exact company+role in js_applications (catches direct/chat submissions)
      const { rows: appRows } = await client.queryObject(
        `SELECT status, created_at FROM js_applications
         WHERE lower(COALESCE(company_name_raw, '')) = lower($1) AND lower(role_title) = lower($2)
         ORDER BY created_at DESC LIMIT 1`,
        [args.company_name, args.role_title],
      );
      if ((appRows as any[]).length > 0) {
        const r = appRows[0] as any;
        const ts = r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at;
        return { seen: true, outcome: "fit", source: "direct", is_repost: false, last_seen_at: ts, first_seen_at: ts };
      }

      // Tier 4: Fuzzy prefix match (catches "Acme Corp" vs "Acme Corporation",
      //         reposted roles with slightly different title capitalisation)
      const coPrefix = args.company_name.substring(0, 12).toLowerCase();
      const rolePrefix = args.role_title.substring(0, 10).toLowerCase();
      if (coPrefix.length >= 4 && rolePrefix.length >= 4) {
        const { rows: fuzzyRows } = await client.queryObject(
          `SELECT outcome, first_seen_at, created_at FROM js_ingested_positions
           WHERE lower(company_name) LIKE $1 AND lower(role_title) LIKE $2
           ORDER BY created_at DESC LIMIT 1`,
          [`${coPrefix}%`, `${rolePrefix}%`],
        );
        if ((fuzzyRows as any[]).length > 0) {
          const r = fuzzyRows[0] as any;
          const firstSeen: Date = r.first_seen_at ?? r.created_at;
          const daysSince = (Date.now() - new Date(firstSeen).getTime()) / 86400000;
          return {
            seen: true, outcome: r.outcome, source: "ingest",
            is_repost: daysSince > REPOST_DAYS,
            last_seen_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
            first_seen_at: firstSeen instanceof Date ? firstSeen.toISOString() : firstSeen,
          };
        }
      }
    }

    return { seen: false };
  } finally { client.release(); }
}

export interface LogIngestedPositionArgs {
  source_url?: string;
  company_name: string;
  role_title: string;
  profile_slug?: string;
  search_run_id?: string;
  application_id?: string;
  outcome: "fit" | "no-fit" | "duplicate" | "fetch-failed";
  no_fit_reason?: string;
  is_repost?: boolean;
  first_seen_at?: string;
}

export async function logIngestedPositionCore(
  pool: unknown,
  args: LogIngestedPositionArgs,
): Promise<{ id: string }> {
  const client = await (pool as any).connect();
  try {
    const { rows } = await client.queryObject(
      `INSERT INTO js_ingested_positions
         (source_url, company_name, role_title, profile_slug, search_run_id,
          application_id, outcome, no_fit_reason, is_repost, first_seen_at)
       VALUES ($1, $2, $3, $4, $5::uuid, $6::uuid, $7, $8, $9, $10)
       RETURNING id`,
      [
        args.source_url ?? null,
        args.company_name,
        args.role_title,
        args.profile_slug ?? null,
        args.search_run_id ?? null,
        args.application_id ?? null,
        args.outcome,
        args.no_fit_reason ?? null,
        args.is_repost ?? false,
        args.first_seen_at ? new Date(args.first_seen_at) : null,
      ],
    );
    return { id: (rows[0] as any).id };
  } finally { client.release(); }
}

export async function getIngestionHistoryCore(
  pool: unknown,
  args: { profile_slug?: string; outcome?: string; limit?: number; direct_only?: boolean },
): Promise<unknown[]> {
  const { profile_slug, outcome, limit = 50, direct_only } = args;
  const client = await (pool as any).connect();
  try {
    const where: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    if (profile_slug) { where.push(`profile_slug = $${p++}`); params.push(profile_slug); }
    if (outcome) { where.push(`outcome = $${p++}`); params.push(outcome); }
    if (direct_only) { where.push(`search_run_id IS NULL`); }
    params.push(limit);

    const { rows } = await client.queryObject(
      `SELECT id, company_name, role_title, profile_slug, outcome, no_fit_reason,
              is_repost, first_seen_at, created_at
       FROM js_ingested_positions
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY created_at DESC
       LIMIT $${p}`,
      params,
    );
    return rows as unknown[];
  } finally { client.release(); }
}

// ===========================================================================
// INGEST TRACKING TOOLS
// ===========================================================================

export function registerCheckPositionSeenTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "check_position_seen",
    "Check if a job position has been seen before (4-tier: URL exact → company+role exact in ingest history " +
    "→ company+role in active pipeline [catches direct/chat submissions] → fuzzy prefix match). " +
    "Returns is_repost=true when the position was first seen >60 days ago.",
    {
      source_url: z.string().nullish().describe("Source URL of the job posting"),
      company_name: z.string().nullish().describe("Company name to check"),
      role_title: z.string().nullish().describe("Role title to check"),
    },
    async (args: CheckPositionSeenArgs) => {
      const result = await checkPositionSeenCore(pool, args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );
}

export function registerLogIngestedPositionTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "log_ingested_position",
    "Record a job position encountered during /ingest or submitted via chat. " +
    "Creates an audit trail entry. Replaces seen-jobs.json writes.",
    {
      source_url: z.string().nullish(),
      company_name: z.string(),
      role_title: z.string(),
      profile_slug: z.string().nullish(),
      search_run_id: z.string().nullish().describe("UUID of the js_search_runs row for this batch run"),
      application_id: z.string().nullish().describe("UUID of js_applications row (for fit outcomes)"),
      outcome: z.enum(["fit", "no-fit", "duplicate", "fetch-failed"]),
      no_fit_reason: z.string().nullish(),
      is_repost: z.boolean().optional().default(false),
      first_seen_at: z.string().nullish().describe("ISO timestamp of original sighting (for repost tracking)"),
    },
    async (args: LogIngestedPositionArgs) => {
      const result = await logIngestedPositionCore(pool, args);
      traceSpan({
        name: "job-screened",
        tags: ["service:job-search", `outcome:${args.outcome}`],
        metadata: {
          company: args.company_name,
          role: args.role_title,
          outcome: args.outcome,
          no_fit_reason: args.no_fit_reason ?? null,
          profile_slug: args.profile_slug ?? null,
          search_run_id: args.search_run_id ?? null,
          is_repost: args.is_repost ?? false,
        },
      }).catch(() => {});
      return {
        content: [{
          type: "text",
          text: `Logged: ${args.company_name} / ${args.role_title} → ${args.outcome} (${result.id})`,
        }],
      };
    },
  );
}

export function registerGetIngestionHistoryTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "get_ingestion_history",
    "List recent ingested positions with outcome breakdown. Canonical record of all positions " +
    "encountered during job search — replaces seen-jobs.json as the dedup source.",
    {
      profile_slug: z.string().nullish().describe("Filter to a specific profile"),
      outcome: z.enum(["fit", "no-fit", "duplicate", "fetch-failed"]).nullish(),
      limit: z.number().int().min(1).max(500).default(50),
    },
    async (args: { profile_slug?: string; outcome?: string; limit: number }) => {
      const rows = await getIngestionHistoryCore(pool, args);
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    },
  );
}

// ---------------------------------------------------------------------------
// Registration helper — call from job-search-server.ts main()
// ---------------------------------------------------------------------------

export function registerJobSearchTools(server: unknown, pool: unknown, callbacks: JobSearchCallbacks = {}) {
  const { captureThought, searchThoughts, embedQuery, chunkContent } = callbacks;

  // File tools
  registerUploadFileTool(server, pool, captureThought, chunkContent);
  registerGetFileTool(server);
  registerGetFileUrlTool(server);
  registerListFilesTool(server, pool);
  registerDeleteFileTool(server, pool);
  registerDeleteApplicationTool(server, pool);

  // State tools
  registerGetPipelineTool(server, pool);
  registerGetApplicationTool(server, pool);
  registerCreateApplicationTool(server, pool);
  registerUpdateApplicationStatusTool(server, pool);
  registerLogInterviewTool(server, pool);
  registerCompleteInterviewTool(server, pool);
  registerGetOverdueFollowupsTool(server, pool);
  registerAddContactTool(server, pool);
  registerGetContactsTool(server, pool);
  registerUpsertCompanyTool(server, pool);
  registerUpsertProfileTool(server, pool);
  registerLogSearchRunTool(server, pool);
  registerGetSearchRunsTool(server, pool);
  registerSearchApplicationsSemanticTool(server, pool, searchThoughts);

  // Phase 2: section-level chunk search
  registerSearchChunksSemanticTool(server, pool, embedQuery);

  // Phase 3: structured metadata + cross-app pattern matching
  registerUpdateApplicationFieldsTool(server, pool);
  registerFindSimilarApplicationsTool(server, pool, embedQuery);

  // Ingest tracking tools (Phase 1 — replaces seen-jobs.json)
  registerCheckPositionSeenTool(server, pool);
  registerLogIngestedPositionTool(server, pool);
  registerGetIngestionHistoryTool(server, pool);
}
