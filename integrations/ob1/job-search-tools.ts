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
export type JobSearchCallbacks = { captureThought?: CaptureThoughtFn; searchThoughts?: SearchThoughtsFn };

// ===========================================================================
// FILE CORE FUNCTIONS
// ===========================================================================

export async function uploadFileCore(
  pool: unknown,
  captureThoughtFn: CaptureThoughtFn | undefined,
  args: { key: string; content: string; content_type: string; binary: boolean },
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

export function registerUploadFileTool(server: unknown, pool: unknown, captureThoughtFn?: CaptureThoughtFn) {
  (server as any).tool(
    "upload_file",
    "Upload a file to the object store and record it in OB1. " +
    "Text files (text/markdown, text/plain, application/json) are also captured as semantic thoughts.",
    {
      key: z.string().describe("Object store key, e.g. 'applications/2026-05-15-co-role/notes.md'"),
      content: z.string().describe("File content (text) or base64-encoded bytes for binary files"),
      content_type: z.string().default("text/markdown"),
      binary: z.boolean().default(false).describe("Set true and base64-encode content for PDFs/binaries"),
    },
    async (args: { key: string; content: string; content_type: string; binary: boolean }) => {
      const result = await uploadFileCore(pool, captureThoughtFn, args);
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

export async function getApplicationCore(pool: unknown, identifier: string): Promise<unknown | null> {
  const client = await (pool as any).connect();
  try {
    const isUuid = /^[0-9a-f-]{36}$/.test(identifier);
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
       WHERE ${isUuid ? "a.id = $1::uuid" : "LOWER(COALESCE(c.name, a.company_name_raw)) LIKE LOWER($1)"}
       LIMIT 1`,
      [isUuid ? identifier : `%${identifier}%`],
    );
    if (!rows.length) return null;

    const app = rows[0] as any;
    const { rows: files } = await client.queryObject(
      "SELECT storage_key, content_type, file_size FROM js_files WHERE storage_key LIKE $1 ORDER BY storage_key",
      [((app.folder_prefix ?? "") + "%")],
    );
    const { rows: interviews } = await client.queryObject(
      "SELECT stage, scheduled_at, completed_at, rating FROM js_interviews WHERE application_id = $1 ORDER BY created_at",
      [app.id],
    );
    return { ...app, files, interviews };
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

export async function logSearchRunCore(pool: unknown, args: LogSearchRunArgs): Promise<void> {
  const client = await (pool as any).connect();
  try {
    const { rows: pRows } = await client.queryObject(
      "SELECT id FROM js_profiles WHERE slug = $1", [args.profile_slug],
    );
    const profileId = (pRows[0] as any)?.id ?? null;
    await client.queryObject(
      `INSERT INTO js_search_runs
         (profile_id, query, pages_fetched, total_results, new_after_dedup, screened, fit_count, summary_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [profileId, args.query, args.pages_fetched, args.total_results,
       args.new_after_dedup, args.screened, args.fit_count, args.summary_key ?? null],
    );
  } finally { client.release(); }
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
    "Get full application record plus list of associated files. Accepts company name fragment or UUID.",
    { identifier: z.string().describe("Company name (partial match OK) or application UUID") },
    async ({ identifier }: { identifier: string }) => {
      const result = await getApplicationCore(pool, identifier);
      if (!result) return { content: [{ type: "text", text: `No application found matching: ${identifier}` }] };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
      await logSearchRunCore(pool, args);
      return {
        content: [{
          type: "text",
          text: `Search run logged: ${args.profile_slug}, ${args.fit_count} fits from ${args.total_results} results`,
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

// ---------------------------------------------------------------------------
// Registration helper — call from job-search-server.ts main()
// ---------------------------------------------------------------------------

export function registerJobSearchTools(server: unknown, pool: unknown, callbacks: JobSearchCallbacks = {}) {
  const { captureThought, searchThoughts } = callbacks;

  // File tools
  registerUploadFileTool(server, pool, captureThought);
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
  registerLogSearchRunTool(server, pool);
  registerSearchApplicationsSemanticTool(server, pool, searchThoughts);
}
