/**
 * Job Search MCP Tools for OB1
 *
 * Imported by job-search-server.ts (the sidecar entry point).
 * Prerequisites: job-search-schema.sql applied to the OB1 Postgres instance.
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

async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
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

// ---------------------------------------------------------------------------
// FILE TOOLS
// ---------------------------------------------------------------------------

/**
 * upload_file
 * Dual-persist: write to object store + upsert js_files + optionally capture thought.
 */
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
    async ({ key, content, content_type, binary }: {
      key: string; content: string; content_type: string; binary: boolean
    }) => {
      const bytes = binary
        ? Uint8Array.from(atob(content), c => c.charCodeAt(0))
        : new TextEncoder().encode(content);

      // 1. Write to object store
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: bytes,
        ContentType: content_type,
      }));

      // 2. Capture semantic thought for text content
      let thoughtId: string | null = null;
      if (!binary && isTextType(content_type) && content.length > 50 && captureThoughtFn) {
        try {
          thoughtId = await captureThoughtFn(content, {
            type: "file",
            storage_key: key,
            content_type,
          });
        } catch { /* thought capture is best-effort */ }
      }

      // 3. Upsert js_files record
      const client = await (pool as any).connect();
      try {
        await client.query(
          `INSERT INTO js_files (storage_key, bucket, content_type, file_size, thought_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (storage_key) DO UPDATE SET
             bucket = EXCLUDED.bucket,
             content_type = EXCLUDED.content_type,
             file_size = EXCLUDED.file_size,
             thought_id = COALESCE(EXCLUDED.thought_id, js_files.thought_id),
             updated_at = now()`,
          [key, BUCKET, content_type, bytes.length, thoughtId]
        );
      } finally {
        client.release();
      }

      return { content: [{ type: "text", text: `Uploaded: ${key} (${bytes.length} bytes)` }] };
    }
  );
}

/**
 * get_file
 * Fetch file content from the object store.
 */
export function registerGetFileTool(server: unknown) {
  (server as any).tool(
    "get_file",
    "Read a file from the object store. Returns text content directly; binary files return base64.",
    {
      key: z.string().describe("Object store key"),
    },
    async ({ key }: { key: string }) => {
      const res: GetObjectCommandOutput = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      const contentType = res.ContentType ?? "application/octet-stream";
      const bytes = await streamToBytes(res.Body as ReadableStream<Uint8Array>);

      if (isTextType(contentType)) {
        return { content: [{ type: "text", text: new TextDecoder().decode(bytes) }] };
      }
      // Binary: return base64
      const b64 = btoa(String.fromCharCode(...bytes));
      return { content: [{ type: "text", text: b64 }], _binary: true, _contentType: contentType };
    }
  );
}

/**
 * get_file_url
 * Generate a presigned URL for direct browser access (PDFs, downloads).
 */
export function registerGetFileUrlTool(server: unknown) {
  (server as any).tool(
    "get_file_url",
    "Generate a presigned URL for a file (valid for `expires_in` seconds, default 3600).",
    {
      key: z.string(),
      expires_in: z.number().int().min(60).max(86400).default(3600),
    },
    async ({ key, expires_in }: { key: string; expires_in: number }) => {
      const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
        expiresIn: expires_in,
      });
      return { content: [{ type: "text", text: url }] };
    }
  );
}

/**
 * list_files
 * List object store keys under a prefix (folder listing).
 */
export function registerListFilesTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "list_files",
    "List files stored under a given prefix (like a folder listing).",
    {
      prefix: z.string().describe("Key prefix, e.g. 'applications/2026-05-15-co-role/'"),
    },
    async ({ prefix }: { prefix: string }) => {
      const client = await (pool as any).connect();
      try {
        const { rows } = await client.query(
          `SELECT storage_key, content_type, file_size, updated_at
           FROM js_files
           WHERE storage_key LIKE $1
           ORDER BY storage_key`,
          [prefix + "%"]
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify(rows.map((r: any) => ({
              key: r.storage_key,
              content_type: r.content_type,
              size: r.file_size,
              updated_at: r.updated_at,
            })), null, 2),
          }],
        };
      } finally {
        client.release();
      }
    }
  );
}

/**
 * delete_file
 */
export function registerDeleteFileTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "delete_file",
    "Delete a file from the object store and remove its js_files record.",
    { key: z.string() },
    async ({ key }: { key: string }) => {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
      const client = await (pool as any).connect();
      try {
        await client.query("DELETE FROM js_files WHERE storage_key = $1", [key]);
      } finally {
        client.release();
      }
      return { content: [{ type: "text", text: `Deleted: ${key}` }] };
    }
  );
}

// ---------------------------------------------------------------------------
// STATE TOOLS
// ---------------------------------------------------------------------------

/**
 * get_pipeline
 */
export function registerGetPipelineTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "get_pipeline",
    "List applications with optional filters. Returns pipeline state from js_applications.",
    {
      status: z.string().optional().describe("Filter by status, e.g. 'applied'"),
      priority: z.number().int().min(1).max(3).optional(),
      due_before: z.string().optional().describe("ISO date — return apps with follow_up_date before this"),
      limit: z.number().int().min(1).max(200).default(50),
    },
    async ({ status, priority, due_before, limit }: {
      status?: string; priority?: number; due_before?: string; limit: number
    }) => {
      const client = await (pool as any).connect();
      try {
        const where: string[] = [];
        const params: unknown[] = [];
        let p = 1;
        if (status) { where.push(`a.status = $${p++}`); params.push(status); }
        if (priority) { where.push(`a.priority = $${p++}`); params.push(priority); }
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

        const { rows } = await client.query(sql, params);
        return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
      } finally {
        client.release();
      }
    }
  );
}

/**
 * get_application
 */
export function registerGetApplicationTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "get_application",
    "Get full application record plus list of associated files. Accepts company name fragment or UUID.",
    { identifier: z.string().describe("Company name (partial match OK) or application UUID") },
    async ({ identifier }: { identifier: string }) => {
      const client = await (pool as any).connect();
      try {
        const isUuid = /^[0-9a-f-]{36}$/.test(identifier);
        const { rows } = await client.query(
          `SELECT a.*, COALESCE(c.name, a.company_name_raw) AS company_name,
                  c.industry, c.remote_policy, p.slug AS profile_slug, p.display_name AS profile_name
           FROM js_applications a
           LEFT JOIN js_companies c ON a.company_id = c.id
           LEFT JOIN js_profiles p ON a.profile_id = p.id
           WHERE ${isUuid ? "a.id = $1" : "LOWER(COALESCE(c.name, a.company_name_raw)) LIKE LOWER($1)"}
           LIMIT 1`,
          [isUuid ? identifier : `%${identifier}%`]
        );
        if (!rows.length) {
          return { content: [{ type: "text", text: `No application found matching: ${identifier}` }] };
        }
        const app = rows[0];

        // List associated files
        const { rows: files } = await client.query(
          "SELECT storage_key, content_type, file_size FROM js_files WHERE storage_key LIKE $1 ORDER BY storage_key",
          [(app.folder_prefix ?? "") + "%"]
        );

        // List interviews
        const { rows: interviews } = await client.query(
          "SELECT stage, scheduled_at, completed_at, rating FROM js_interviews WHERE application_id = $1 ORDER BY created_at",
          [app.id]
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ ...app, files, interviews }, null, 2),
          }],
        };
      } finally {
        client.release();
      }
    }
  );
}

/**
 * update_application_status
 */
export function registerUpdateApplicationStatusTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "update_application_status",
    "Atomically update the status of an application. Also sets follow_up_date if not provided (applied → +14 days).",
    {
      id: z.string().describe("Application UUID"),
      status: z.string(),
      status_detail: z.string().optional(),
      follow_up_date: z.string().optional().describe("ISO date for next follow-up"),
      applied_date: z.string().optional().describe("ISO date when submitted (sets applied_date if status=applied)"),
    },
    async ({ id, status, status_detail, follow_up_date, applied_date }: {
      id: string; status: string; status_detail?: string;
      follow_up_date?: string; applied_date?: string;
    }) => {
      const client = await (pool as any).connect();
      try {
        // Auto-set follow_up +14 days when transitioning to applied
        const fup = follow_up_date ?? (status === "applied"
          ? new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
          : undefined);

        const sets: string[] = ["status = $2", "updated_at = now()"];
        const params: unknown[] = [id, status];
        let p = 3;
        if (status_detail !== undefined) { sets.push(`status_detail = $${p++}`); params.push(status_detail); }
        if (fup !== undefined) { sets.push(`follow_up_date = $${p++}`); params.push(fup); }
        if (applied_date !== undefined) { sets.push(`applied_date = $${p++}`); params.push(applied_date); }
        else if (status === "applied") { sets.push(`applied_date = COALESCE(applied_date, now()::date)`); }

        const { rowCount } = await client.query(
          `UPDATE js_applications SET ${sets.join(", ")} WHERE id = $1`,
          params
        );
        if (!rowCount) return { content: [{ type: "text", text: `Application not found: ${id}` }] };
        return { content: [{ type: "text", text: `Updated ${id} → ${status}${fup ? ` (follow-up: ${fup})` : ""}` }] };
      } finally {
        client.release();
      }
    }
  );
}

/**
 * log_interview
 */
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
    async (args: {
      application_id: string; stage: string; scheduled_at?: string;
      interviewer_name?: string; interviewer_title?: string; pre_notes?: string;
    }) => {
      const client = await (pool as any).connect();
      try {
        const { rows } = await client.query(
          `INSERT INTO js_interviews (application_id, stage, scheduled_at, interviewer_name, interviewer_title, pre_notes)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [args.application_id, args.stage, args.scheduled_at ?? null,
           args.interviewer_name ?? null, args.interviewer_title ?? null, args.pre_notes ?? null]
        );
        await client.query(
          "UPDATE js_applications SET status = 'interview-scheduled', updated_at = now() WHERE id = $1 AND status NOT IN ('interviewed','offer','closed')",
          [args.application_id]
        );
        return { content: [{ type: "text", text: `Interview logged: ${rows[0].id} (${args.stage})` }] };
      } finally {
        client.release();
      }
    }
  );
}

/**
 * complete_interview
 */
export function registerCompleteInterviewTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "complete_interview",
    "Record post-interview debrief notes and rating. Updates application status to 'interviewed'.",
    {
      interview_id: z.string(),
      post_notes: z.string().describe("Debrief notes after the call"),
      rating: z.number().int().min(1).max(5).optional().describe("Self-assessment 1-5"),
    },
    async ({ interview_id, post_notes, rating }: {
      interview_id: string; post_notes: string; rating?: number
    }) => {
      const client = await (pool as any).connect();
      try {
        const { rows } = await client.query(
          `UPDATE js_interviews SET post_notes = $2, rating = $3, completed_at = now(), updated_at = now()
           WHERE id = $1 RETURNING application_id`,
          [interview_id, post_notes, rating ?? null]
        );
        if (!rows.length) return { content: [{ type: "text", text: `Interview not found: ${interview_id}` }] };
        await client.query(
          "UPDATE js_applications SET status = 'interviewed', updated_at = now() WHERE id = $1",
          [rows[0].application_id]
        );
        return { content: [{ type: "text", text: `Interview ${interview_id} completed. Debrief saved.` }] };
      } finally {
        client.release();
      }
    }
  );
}

/**
 * get_overdue_followups
 */
export function registerGetOverdueFollowupsTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "get_overdue_followups",
    "List applications where follow_up_date is today or earlier and status is still active.",
    {},
    async () => {
      const client = await (pool as any).connect();
      try {
        const { rows } = await client.query(
          `SELECT a.id, COALESCE(c.name, a.company_name_raw) AS company,
                  a.role_title, a.status, a.follow_up_date,
                  (now()::date - a.follow_up_date) AS days_overdue
           FROM js_applications a
           LEFT JOIN js_companies c ON a.company_id = c.id
           WHERE a.follow_up_date <= now()::date
             AND a.status NOT IN ('closed', 'offer')
           ORDER BY a.follow_up_date ASC`
        );
        return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
      } finally {
        client.release();
      }
    }
  );
}

/**
 * add_contact
 */
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
    async (args: {
      name: string; company_name?: string; title?: string; email?: string;
      linkedin_url?: string; relationship_type: string; notes?: string;
    }) => {
      const client = await (pool as any).connect();
      try {
        // Resolve company_id if provided
        let companyId: string | null = null;
        if (args.company_name) {
          const { rows } = await client.query(
            "SELECT id FROM js_companies WHERE LOWER(name) = LOWER($1) LIMIT 1",
            [args.company_name]
          );
          companyId = rows[0]?.id ?? null;
        }
        const { rows } = await client.query(
          `INSERT INTO js_contacts (name, company_id, title, email, linkedin_url, relationship_type, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [args.name, companyId, args.title ?? null, args.email ?? null,
           args.linkedin_url ?? null, args.relationship_type, args.notes ?? null]
        );
        return { content: [{ type: "text", text: `Contact added: ${args.name} (${rows[0].id})` }] };
      } finally {
        client.release();
      }
    }
  );
}

/**
 * get_contacts
 */
export function registerGetContactsTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "get_contacts",
    "List contacts, optionally filtered by company name.",
    { company: z.string().optional() },
    async ({ company }: { company?: string }) => {
      const client = await (pool as any).connect();
      try {
        const { rows } = await client.query(
          `SELECT ct.name, ct.title, ct.relationship_type, ct.email, ct.linkedin_url,
                  ct.notes, ct.last_contact_at, ct.follow_up_date,
                  COALESCE(c.name, '') AS company_name
           FROM js_contacts ct
           LEFT JOIN js_companies c ON ct.company_id = c.id
           ${company ? "WHERE LOWER(c.name) LIKE LOWER($1)" : ""}
           ORDER BY ct.last_contact_at DESC NULLS LAST`,
          company ? [`%${company}%`] : []
        );
        return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
      } finally {
        client.release();
      }
    }
  );
}

/**
 * upsert_company
 */
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
    async (args: {
      name: string; slug: string; industry?: string; size_range?: string;
      remote_policy?: string; website?: string; domain_tags?: string[]; notes?: string;
    }) => {
      const client = await (pool as any).connect();
      try {
        const { rows } = await client.query(
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
           args.domain_tags ?? null, args.notes ?? null]
        );
        return { content: [{ type: "text", text: `Company: ${args.name} (${rows[0].id})` }] };
      } finally {
        client.release();
      }
    }
  );
}

/**
 * log_search_run
 */
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
    async (args: {
      profile_slug: string; query: string; pages_fetched: number; total_results: number;
      new_after_dedup: number; screened: number; fit_count: number; summary_key?: string;
    }) => {
      const client = await (pool as any).connect();
      try {
        const { rows: pRows } = await client.query(
          "SELECT id FROM js_profiles WHERE slug = $1", [args.profile_slug]
        );
        const profileId = pRows[0]?.id ?? null;
        await client.query(
          `INSERT INTO js_search_runs
             (profile_id, query, pages_fetched, total_results, new_after_dedup, screened, fit_count, summary_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [profileId, args.query, args.pages_fetched, args.total_results,
           args.new_after_dedup, args.screened, args.fit_count, args.summary_key ?? null]
        );
        return {
          content: [{
            type: "text",
            text: `Search run logged: ${args.profile_slug}, ${args.fit_count} fits from ${args.total_results} results`,
          }],
        };
      } finally {
        client.release();
      }
    }
  );
}

/**
 * search_applications_semantic
 */
export function registerSearchApplicationsSemanticTool(server: unknown, pool: unknown, searchThoughtsFn?: SearchThoughtsFn) {
  (server as any).tool(
    "search_applications_semantic",
    "Semantic search across all application notes, JDs, and research using pgvector.",
    {
      query: z.string().describe("Natural language query, e.g. 'AI governance domain fit'"),
      limit: z.number().int().min(1).max(20).default(5),
    },
    async ({ query, limit }: { query: string; limit: number }) => {
      if (!searchThoughtsFn) {
        return { content: [{ type: "text", text: "search_applications_semantic: searchThoughts callback not configured" }] };
      }
      try {
        const results = await searchThoughtsFn(query, limit, { source: "job-search-mcp" });
        if (!results.length) {
          return { content: [{ type: "text", text: `No application content found matching "${query}".` }] };
        }
        const formatted = results.map((r, i) =>
          `--- ${i + 1} (${(r.similarity * 100).toFixed(1)}% match) ---\n${r.content}`
        ).join("\n\n");
        return { content: [{ type: "text", text: formatted }] };
      } catch (err: unknown) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Registration helper — call from index.ts main()
// ---------------------------------------------------------------------------

export function registerJobSearchTools(server: unknown, pool: unknown, callbacks: JobSearchCallbacks = {}) {
  const { captureThought, searchThoughts } = callbacks;

  // File tools
  registerUploadFileTool(server, pool, captureThought);
  registerGetFileTool(server);
  registerGetFileUrlTool(server);
  registerListFilesTool(server, pool);
  registerDeleteFileTool(server, pool);

  // State tools
  registerGetPipelineTool(server, pool);
  registerGetApplicationTool(server, pool);
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
