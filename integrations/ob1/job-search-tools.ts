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
import { extractText as extractPdfText } from "unpdf";
import mammoth from "mammoth";

// ---------------------------------------------------------------------------
// Object store client (MinIO or Supabase Storage, configured by env)
// ---------------------------------------------------------------------------

const OBJECT_STORE_BACKEND = Deno.env.get("OBJECT_STORE_BACKEND") ?? "minio";
const BUCKET = Deno.env.get("MINIO_BUCKET") ?? Deno.env.get("SUPABASE_BUCKET") ?? "job-search";
const CITATION_BASE_URL =
  Deno.env.get("CITATION_BASE_URL") ?? "http://localhost/job-search/thoughts";

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
  return contentType.startsWith("text/")
    || contentType === "application/json"
    || contentType === "application/xhtml+xml";
}

// ---------------------------------------------------------------------------
// Phase 3: text extraction, context derivation, and category inference
// ---------------------------------------------------------------------------

// Walk a DOM element and emit best-effort markdown, preserving heading structure.
function domToMarkdown(el: Element | null): string {
  if (!el) return "";
  const lines: string[] = [];
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node as Text).textContent?.trim();
      if (t) lines.push(t);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).tagName;
      const inner = domToMarkdown(node as Element).trim();
      if (!inner) continue;
      if (tag === "H1" || tag === "H2") lines.push(`## ${inner}`);
      else if (tag === "H3" || tag === "H4") lines.push(`### ${inner}`);
      else if (tag === "LI") lines.push(`- ${inner}`);
      else if (["P", "DIV", "SECTION", "ARTICLE"].includes(tag)) {
        lines.push(inner);
        lines.push("");
      } else {
        lines.push(inner);
      }
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Send a PDF to Haiku as a document block and get back markdown + thought_category in one call.
// Returns null if the API key is absent or the call fails — caller should fall back to unpdf.
async function extractMarkdownViaHaiku(
  bytes: Uint8Array,
  filename: string,
  ctx: UploadContext,
): Promise<{ markdown: string; thought_category: string } | null> {
  if (!ANTHROPIC_API_KEY) return null;
  const prompt = [
    "You are processing a document for a job search knowledge system.",
    "",
    "Output format (two sections, required):",
    "Line 1: exactly one thought_category label (snake_case only)",
    "Line 2: ---",
    "Lines 3+: the full document converted to well-structured markdown",
    "",
    "Category options: jd_analysis, fit_assessment, domain_connection, company_research,",
    "resume_strategy, interview_prep, meeting_notes, email, exercise, application_event, achievement",
    "",
    "Markdown rules:",
    "- Preserve ALL content verbatim; do not summarize or omit anything",
    "- Use ## for major sections (Requirements, Responsibilities, About the Role, etc.)",
    "- Use ### for subsections; bullet lists for requirement/responsibility lists",
    "- Separate paragraphs with blank lines",
    "",
    `Context: ${ctx.directoryType} directory, company: ${ctx.company ?? "unknown"}, filename: ${filename}`,
    "Default category: jd_analysis for JDs, exercise for exercise docs, interview_prep for interview materials.",
  ].join("\n");
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: INFERENCE_MODEL,
        max_tokens: 4096,
        temperature: 0,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytesToBase64(bytes) } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const output = (data?.content?.[0]?.text ?? "").trim();
    const sepIdx = output.indexOf("\n---\n");
    if (sepIdx === -1) return null;
    const thought_category = output.slice(0, sepIdx).trim().replace(/[^a-z_]/g, "");
    const markdown = output.slice(sepIdx + 5).trim();
    return markdown ? { markdown, thought_category } : null;
  } catch {
    return null;
  }
}

// Convert uploaded file bytes to best-effort markdown for thought capture and chunking.
// HTML → DOM walk; DOCX → mammoth heading style map; PDF → unpdf plain text (Haiku handles PDF upstream);
// text/* → pass through; other binary → null.
async function extractAsMarkdown(
  bytes: Uint8Array,
  contentType: string,
  rawText?: string,
): Promise<string | null> {
  try {
    if (contentType === "text/html" || contentType === "application/xhtml+xml") {
      const html = rawText ?? new TextDecoder().decode(bytes);
      const doc = new DOMParser().parseFromString(html, "text/html");
      return domToMarkdown(doc.body);
    }
    if (contentType === "application/pdf") {
      // Fallback path (used when ANTHROPIC_API_KEY is absent or Haiku call fails).
      const { text } = await extractPdfText(bytes, { mergePages: true });
      return text ?? null;
    }
    if (
      contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      || contentType === "application/msword"
    ) {
      const result = await mammoth.convert(
        { buffer: bytes.buffer as unknown as any },
        { styleMap: [
          "p[style-name='Heading 1'] => ## $1",
          "p[style-name='Heading 2'] => ## $1",
          "p[style-name='Heading 3'] => ### $1",
        ]},
      );
      return result.value?.trim() || null;
    }
    if (isTextType(contentType)) {
      return rawText ?? new TextDecoder().decode(bytes);
    }
    return null;
  } catch {
    return null;
  }
}

interface UploadContext {
  directoryType: "application" | "profile" | "search" | "docs" | "unknown";
  applicationStatus?: string;
  company?: string;
  profileSlug?: string;
}

async function deriveUploadContext(key: string, pool: unknown): Promise<UploadContext> {
  const parts = key.split("/");
  if (parts[0] === "applications" && parts[1]) {
    const folder = parts[1];
    try {
      const c = await (pool as any).connect();
      try {
        const r = await c.queryObject(
          `SELECT status, company_id FROM js_applications WHERE folder_prefix = $1 LIMIT 1`,
          [folder],
        );
        if (r.rows[0]) {
          const row = r.rows[0] as any;
          let company: string | undefined;
          if (row.company_id) {
            const cr = await c.queryObject(
              `SELECT name FROM js_companies WHERE id = $1 LIMIT 1`, [row.company_id],
            );
            company = (cr.rows[0] as any)?.name;
          }
          return { directoryType: "application", applicationStatus: row.status, company };
        }
      } finally { c.release(); }
    } catch { /* best-effort */ }
    return { directoryType: "application" };
  }
  if (parts[0] === "profiles" && parts[1]) {
    return { directoryType: "profile", profileSlug: parts[1] };
  }
  if (parts[0] === "search") return { directoryType: "search" };
  if (parts[0] === "docs") return { directoryType: "docs" };
  return { directoryType: "unknown" };
}

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const INFERENCE_MODEL = "claude-haiku-4-5-20251001";

async function inferThoughtCategory(
  text: string,
  filename: string,
  ctx: UploadContext,
): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;
  const snippet = text.slice(0, 2000);
  const prompt = [
    "You classify documents uploaded to a job search knowledge system.",
    "Output exactly one thought_category label for the file below.",
    "",
    `Directory context: ${ctx.directoryType}`,
    `Application status: ${ctx.applicationStatus ?? "unknown"}`,
    `Company: ${ctx.company ?? "unknown"}`,
    `Profile slug: ${ctx.profileSlug ?? "unknown"}`,
    `Filename: ${filename}`,
    "",
    "Suggested categories: jd_analysis, fit_assessment, domain_connection, company_research,",
    "resume_strategy, interview_prep, meeting_notes, email, exercise, application_event, achievement",
    "",
    `Content (first 2000 chars):\n${snippet}`,
    "",
    "Output one snake_case label only. If ambiguous and context is an application, output \"application_event\".",
  ].join("\n");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: INFERENCE_MODEL,
        max_tokens: 20,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const category = (data?.content?.[0]?.text ?? "").trim().replace(/[^a-z_]/g, "");
    return category || null;
  } catch {
    return null;
  }
}

export type CaptureThoughtFn = (content: string, metadata: Record<string, unknown>) => Promise<string>;
export type SearchThoughtsFn = (
  query: string,
  limit: number,
  filter: Record<string, unknown>,
) => Promise<Array<{ id: string; content: string; metadata: Record<string, unknown>; similarity: number; created_at: string }>>;
export type ListThoughtsFn = (
  limit: number,
  type?: string,
  topic?: string,
  person?: string,
  days?: number,
) => Promise<Array<{ id: string; content: string; metadata: Record<string, unknown>; created_at: string }>>;
export type EmbedQueryFn = (query: string) => Promise<number[]>;
export type ChunkContentFn = (content: string, storageKey: string) => Promise<void>;
export type JobSearchCallbacks = {
  captureThought?: CaptureThoughtFn;
  searchThoughts?: SearchThoughtsFn;
  listThoughts?: ListThoughtsFn;
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
  // Headerless sections larger than this get paragraph-split even if under MAX_CHUNK.
  // Catches verbatim JD files (no ## headers) that would otherwise become one giant blob.
  const PARA_SPLIT_SIZE = 1500;
  const chunks: MarkdownChunk[] = [];
  // Split on H2 boundaries; keep the ## header with its section
  const parts = text.split(/(?=\n## )/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length < MIN_CHUNK) continue;
    const headerMatch = trimmed.match(/^## (.+)/);
    const title = headerMatch ? headerMatch[1].trim() : null;
    // Paragraph-split when: (a) oversized, or (b) no H2 header and exceeds PARA_SPLIT_SIZE
    if (trimmed.length <= MAX_CHUNK && !(title === null && trimmed.length > PARA_SPLIT_SIZE)) {
      chunks.push({ title, index: chunks.length, content: trimmed });
    } else {
      // Use PARA_SPLIT_SIZE as target when splitting a headerless section; MAX_CHUNK otherwise.
      const splitTarget = title === null ? PARA_SPLIT_SIZE : MAX_CHUNK;
      // Fall back to single-newline splitting for flat PDFs with no paragraph breaks.
      const paras = trimmed.includes("\n\n")
        ? trimmed.split(/\n\n+/)
        : trimmed.split(/\n/).filter(l => l.trim().length > 0);
      let buf = "";
      let subIdx = 0;
      for (const para of paras) {
        if (buf.length + para.length + 2 > splitTarget && buf.length >= MIN_CHUNK) {
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
  args: { key: string; content: string; content_type: string; binary: boolean; thought_category?: string; application_folder?: string },
  chunkContentFn?: ChunkContentFn,
): Promise<{ key: string; bytes: number; thought_id?: string; thought_category?: string }> {
  const bytes = args.binary
    ? Uint8Array.from(atob(args.content), c => c.charCodeAt(0))
    : new TextEncoder().encode(args.content);

  // Reject 0-byte binary uploads — empty content field causes silent corrupt js_files metadata.
  if (args.binary && bytes.length === 0) {
    throw new Error(
      `Binary upload decoded to 0 bytes — content field is empty or contains invalid base64. ` +
      `PDF/binary files must be uploaded via REST API with a correctly base64-encoded content field.`,
    );
  }

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

  // Phase 3: derive context, extract markdown, infer category, capture thought
  const filename = args.key.split("/").pop() ?? args.key;
  const ctx = await deriveUploadContext(args.application_folder ? `applications/${args.application_folder}/` : args.key, pool);

  let cleanText: string | null = null;
  let thoughtCategory: string | null = args.thought_category ?? null;

  if (args.binary && args.content_type === "application/pdf") {
    // PDF: Haiku converts to markdown and returns category in one call; fall back to unpdf plain text.
    const haiku = await extractMarkdownViaHaiku(bytes, filename, ctx);
    if (haiku) {
      cleanText = haiku.markdown;
      if (!thoughtCategory) thoughtCategory = haiku.thought_category;
    } else {
      cleanText = await extractAsMarkdown(bytes, args.content_type);
    }
  } else if (!args.binary) {
    cleanText = await extractAsMarkdown(bytes, args.content_type, args.content);
  } else {
    cleanText = await extractAsMarkdown(bytes, args.content_type);
  }

  let thoughtId: string | null = null;

  if (cleanText && cleanText.length > 50 && captureThoughtFn) {
    if (!thoughtCategory) {
      thoughtCategory = await inferThoughtCategory(cleanText, filename, ctx);
    }
    try {
      thoughtId = await captureThoughtFn(cleanText, {
        type: "file", storage_key: args.key, content_type: args.content_type,
        ...(thoughtCategory ? { thought_category: thoughtCategory } : {}),
        ...(ctx.profileSlug ? { profile_slug: ctx.profileSlug } : {}),
      });
    } catch { /* best-effort */ }
  }

  {
    const c = await (pool as any).connect();
    try {
      await c.queryObject(
        `INSERT INTO js_files (storage_key, bucket, content_type, file_size, thought_id, thought_category)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (storage_key) DO UPDATE SET
           bucket = EXCLUDED.bucket,
           content_type = EXCLUDED.content_type,
           file_size = EXCLUDED.file_size,
           thought_id = COALESCE(EXCLUDED.thought_id, js_files.thought_id),
           thought_category = COALESCE(EXCLUDED.thought_category, js_files.thought_category),
           updated_at = now()`,
        [args.key, BUCKET, args.content_type, bytes.length, thoughtId, thoughtCategory],
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

  // Phase 2: chunk at H2 boundaries for section-level retrieval.
  // cleanText is best-effort markdown for all types; fall back to args.content for non-binary if null.
  const textToChunk = cleanText ?? (!args.binary ? args.content : null);
  if (textToChunk && textToChunk.length > 50 && chunkContentFn) {
    try {
      await chunkContentFn(textToChunk, args.key);
    } catch { /* best-effort — chunking failure does not fail the upload */ }
  }

  return {
    key: args.key,
    bytes: bytes.length,
    ...(thoughtId ? { thought_id: thoughtId } : {}),
    ...(thoughtCategory ? { thought_category: thoughtCategory } : {}),
  };
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
    await client.queryObject(`
      DELETE FROM thoughts WHERE id IN (
        SELECT jc.thought_id FROM js_chunks jc
        JOIN js_files jf ON jc.file_id = jf.id
        WHERE jf.storage_key = $1 AND jc.thought_id IS NOT NULL
      )`, [key]);
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
    const { rows: co } = await client.queryObject(
      "SELECT id FROM js_companies WHERE LOWER(name) = LOWER($1) OR slug = LOWER($1) LIMIT 1",
      [args.company_name],
    ) as { rows: { id: string }[] };
    const companyId = co[0]?.id ?? null;

    let profileId: string | null = null;
    if (args.profile_slug) {
      const { rows: pr } = await client.queryObject(
        "SELECT id FROM js_profiles WHERE slug = $1 LIMIT 1",
        [args.profile_slug],
      ) as { rows: { id: string }[] };
      profileId = pr[0]?.id ?? null;
    }

    const { rows } = await client.queryObject(
      `INSERT INTO js_applications
         (company_id, company_name_raw, role_title, profile_id, folder_prefix,
          source_url, status, status_detail, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id::text AS id`,
      [companyId, args.company_name, args.role_title, profileId, args.folder_prefix,
       args.source_url ?? null, args.status, args.status_detail ?? null, args.priority],
    ) as { rows: { id: string }[] };
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

export interface UpdateSearchRunArgs {
  id: string;
  summary_key?: string;
}

export async function updateSearchRunCore(pool: unknown, args: UpdateSearchRunArgs): Promise<void> {
  const client = await (pool as any).connect();
  try {
    await client.queryObject(
      `UPDATE js_search_runs SET summary_key = $1 WHERE id = $2`,
      [args.summary_key ?? null, args.id],
    );
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

export function registerUpdateSearchRunTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "update_search_run",
    "Update fields on an existing search run record (e.g. attach summary_key after uploading the summary file).",
    {
      id: z.string().uuid().describe("UUID of the js_search_runs row to update"),
      summary_key: z.string().optional().describe("Object store key for the summary .md file"),
    },
    async (args: UpdateSearchRunArgs) => {
      await updateSearchRunCore(pool, args);
      return {
        content: [{
          type: "text",
          text: `Search run ${args.id} updated.`,
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
         AND (t.embedding <=> $1::vector) < 0.6
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
    "Results filtered to similarity < 0.6 (cosine distance; lower = more similar).",
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

// ===========================================================================
// KNOWLEDGE GRAPH TOOLS (Phase 3 — Knowledge Map)
// Write/read OB1's entities + edges tables directly via the shared pg connection.
// Adds 'requires' (company→skill) and 'demonstrates' (achievement→skill) edges.
// No OB1 server changes required — edges.relation is TEXT, not an enum.
// ===========================================================================

export interface CreateKnowledgeEdgeArgs {
  from_entity_type: string;
  from_entity_name: string;
  relation: string;
  to_entity_type: string;
  to_entity_name: string;
  thought_id?: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeEdgeResult {
  from_entity_id: number;
  to_entity_id: number;
  edge_id: number;
  support_count: number;
  action: "created" | "incremented";
}

async function upsertEntity(
  client: any,
  entity_type: string,
  canonical_name: string,
): Promise<number> {
  const normalized = canonical_name.toLowerCase().trim();
  const { rows } = await client.queryObject(
    `INSERT INTO public.entities(entity_type, canonical_name, normalized_name)
     VALUES($1, $2, $3)
     ON CONFLICT(entity_type, normalized_name) DO UPDATE
       SET last_seen_at = now(), updated_at = now()
     RETURNING id`,
    [entity_type, canonical_name, normalized],
  );
  return Number((rows[0] as any).id);
}

export async function createKnowledgeEdgeCore(
  pool: unknown,
  args: CreateKnowledgeEdgeArgs,
): Promise<KnowledgeEdgeResult> {
  const client = await (pool as any).connect();
  try {
    const fromId = await upsertEntity(client, args.from_entity_type, args.from_entity_name);
    const toId   = await upsertEntity(client, args.to_entity_type,   args.to_entity_name);

    const meta = JSON.stringify(args.metadata ?? {});
    const { rows: erows } = await client.queryObject(
      `INSERT INTO public.edges(from_entity_id, to_entity_id, relation, metadata)
       VALUES($1, $2, $3, $4::jsonb)
       ON CONFLICT(from_entity_id, to_entity_id, relation) DO UPDATE
         SET support_count = public.edges.support_count + 1,
             metadata = excluded.metadata,
             updated_at = now()
       RETURNING id, support_count`,
      [fromId, toId, args.relation, meta],
    );
    const edge    = erows[0] as any;
    const edgeId  = Number(edge.id);
    const sc      = Number(edge.support_count);

    if (args.thought_id) {
      await client.queryObject(
        `INSERT INTO public.thought_entities(thought_id, entity_id, mention_role, source)
         VALUES($1::bigint, $2, 'subject', 'job_search')
         ON CONFLICT(thought_id, entity_id, mention_role) DO NOTHING`,
        [args.thought_id, fromId],
      );
    }

    return { from_entity_id: fromId, to_entity_id: toId, edge_id: edgeId, support_count: sc,
             action: sc === 1 ? "created" : "incremented" };
  } finally { client.release(); }
}

export function registerCreateKnowledgeEdgeTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "create_knowledge_edge",
    "Upsert a typed edge in OB1's entity graph. Creates or updates entities and the directed edge between them. " +
    "Supports 'requires' (company→skill from JD) and 'demonstrates' (achievement→skill from profile). " +
    "Idempotent: re-calling the same (from, relation, to) triple increments support_count.",
    {
      from_entity_type: z.string().describe("'organization' | 'project' | 'tool' | 'topic' | 'person' | 'place'"),
      from_entity_name: z.string().describe("Canonical name of the source entity"),
      relation: z.string().describe("Edge type: 'requires' | 'demonstrates' | 'member_of' | any OB1 relation"),
      to_entity_type: z.string().describe("'tool' | 'topic' | 'organization' | 'person' | 'project' | 'place'"),
      to_entity_name: z.string().describe("Canonical name of the target entity"),
      thought_id: z.string().optional().describe("UUID of a thought to link as evidence via thought_entities"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("e.g. {application_id, source: 'job_search', profile_slug}"),
    },
    async (args: CreateKnowledgeEdgeArgs) => {
      const r = await createKnowledgeEdgeCore(pool, args);
      return {
        content: [{
          type: "text",
          text: `Edge ${r.action}: ${args.from_entity_name} --[${args.relation}]--> ${args.to_entity_name} ` +
                `(support_count=${r.support_count}, edge_id=${r.edge_id})`,
        }],
      };
    },
  );
}

// ---------------------------------------------------------------------------

export interface EntityNeighborArgs {
  entity_name: string;
  entity_type?: string;
  relation?: string;
  direction?: "out" | "in" | "both";
  limit?: number;
}

export interface EntityNeighbor {
  entity_id: number;
  entity_type: string;
  entity_name: string;
  relation: string;
  support_count: number;
  metadata: Record<string, unknown>;
}

export async function getEntityNeighborsCore(
  pool: unknown,
  args: EntityNeighborArgs,
): Promise<EntityNeighbor[]> {
  const direction = args.direction ?? "out";
  const limit     = Math.min(args.limit ?? 20, 100);
  const normalized = args.entity_name.toLowerCase().trim();

  const client = await (pool as any).connect();
  try {
    // Resolve the start entity
    const typeClause = args.entity_type ? " AND e.entity_type = $2" : "";
    const typeParam  = args.entity_type ? [normalized, args.entity_type] : [normalized];
    const { rows: erows } = await client.queryObject(
      `SELECT id FROM public.entities e WHERE e.normalized_name = $1${typeClause} LIMIT 1`,
      typeParam,
    );
    if (!erows.length) return [];
    const entityId = Number((erows[0] as any).id);

    const relClause = args.relation ? "AND ed.relation = $2" : "";
    const buildQuery = (fromCol: string, toCol: string) =>
      `SELECT nb.id AS entity_id, nb.entity_type, nb.canonical_name AS entity_name,
              ed.relation, ed.support_count, ed.metadata
       FROM public.edges ed
       JOIN public.entities nb ON nb.id = ed.${toCol}
       WHERE ed.${fromCol} = $1 ${relClause}`;

    let query = "";
    const params: unknown[] = [entityId];
    if (args.relation) params.push(args.relation);

    if (direction === "out") {
      query = buildQuery("from_entity_id", "to_entity_id");
    } else if (direction === "in") {
      query = buildQuery("to_entity_id", "from_entity_id");
    } else {
      query =
        `SELECT * FROM (${buildQuery("from_entity_id", "to_entity_id")}) q1
         UNION
         SELECT * FROM (${buildQuery("to_entity_id", "from_entity_id")}) q2`;
    }
    query += ` ORDER BY support_count DESC LIMIT ${limit}`;

    const { rows } = await client.queryObject(query, params);
    return (rows as any[]).map((r: any) => ({
      entity_id:     Number(r.entity_id),
      entity_type:   r.entity_type,
      entity_name:   r.entity_name,
      relation:      r.relation,
      support_count: Number(r.support_count),
      metadata:      (r.metadata ?? {}) as Record<string, unknown>,
    }));
  } finally { client.release(); }
}

export function registerGetEntityNeighborsTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "get_entity_neighbors",
    "Query direct neighbors of an entity in OB1's knowledge graph. " +
    "Use direction='out' to find what a company requires (company→skill), " +
    "direction='in' to find achievements that demonstrate a skill (achievement→skill). " +
    "Returns entity name, type, relation, and support_count (edge strength).",
    {
      entity_name:  z.string().describe("Entity to start from (case-insensitive)"),
      entity_type:  z.string().optional().describe("Optional type filter: 'organization' | 'tool' | 'topic' | 'person' | 'project'"),
      relation:     z.string().optional().describe("Optional relation filter: 'requires' | 'demonstrates' | 'member_of'"),
      direction:    z.enum(["out", "in", "both"]).default("out").describe("'out'=from→to, 'in'=to←from, 'both'=union"),
      limit:        z.number().int().min(1).max(100).default(20),
    },
    async (args: EntityNeighborArgs) => {
      const results = await getEntityNeighborsCore(pool, args);
      if (!results.length) {
        return { content: [{ type: "text", text: `No neighbors found for '${args.entity_name}'${args.relation ? ` (relation: ${args.relation})` : ""}.` }] };
      }
      const lines = results.map(r =>
        `${r.entity_name} [${r.entity_type}] via '${r.relation}' (strength=${r.support_count})`,
      );
      return { content: [{ type: "text", text: `Neighbors of '${args.entity_name}':\n${lines.join("\n")}` }] };
    },
  );
}

// ---------------------------------------------------------------------------

export interface TraverseGraphArgs {
  start_entity_name: string;
  start_entity_type?: string;
  relation_types?: string[];
  max_depth?: number;
  direction?: "out" | "in" | "both";
  limit?: number;
}

export interface GraphResult {
  nodes: Array<{ id: number; entity_type: string; entity_name: string }>;
  edges: Array<{ from_id: number; to_id: number; relation: string; support_count: number }>;
}

export async function traverseKnowledgeGraphCore(
  pool: unknown,
  args: TraverseGraphArgs,
): Promise<GraphResult> {
  const maxDepth  = Math.min(args.max_depth ?? 2, 3);
  const maxNodes  = Math.min(args.limit ?? 50, 200);
  const direction = args.direction ?? "out";

  // Resolve start entity
  const startNeighbors = await getEntityNeighborsCore(pool, {
    entity_name: args.start_entity_name,
    entity_type: args.start_entity_type,
    relation: args.relation_types?.[0],
    direction,
    limit: 1,
  });

  const client = await (pool as any).connect();
  try {
    const normalized = args.start_entity_name.toLowerCase().trim();
    const typeClause = args.start_entity_type ? " AND entity_type = $2" : "";
    const typeParam  = args.start_entity_type ? [normalized, args.start_entity_type] : [normalized];
    const { rows: sr } = await client.queryObject(
      `SELECT id, entity_type, canonical_name FROM public.entities WHERE normalized_name = $1${typeClause} LIMIT 1`,
      typeParam,
    );
    if (!sr.length) return { nodes: [], edges: [] };

    const startNode = sr[0] as any;
    const startId   = Number(startNode.id);

    const visited   = new Set<number>([startId]);
    const nodes: GraphResult["nodes"] = [{ id: startId, entity_type: startNode.entity_type, entity_name: startNode.canonical_name }];
    const edges: GraphResult["edges"] = [];
    let frontier    = [startId];

    for (let depth = 0; depth < maxDepth && frontier.length > 0 && nodes.length < maxNodes; depth++) {
      const nextFrontier: number[] = [];

      const fromCol   = direction === "in" ? "to_entity_id" : "from_entity_id";
      const toCol     = direction === "in" ? "from_entity_id" : "to_entity_id";
      const relFilter = args.relation_types?.length
        ? `AND ed.relation = ANY($2::text[])`
        : "";

      const params: unknown[] = [frontier];
      if (args.relation_types?.length) params.push(args.relation_types);

      const limitClause = maxNodes - nodes.length;
      const { rows: hopRows } = await client.queryObject(
        `SELECT ed.${fromCol} AS src_id, ed.${toCol} AS nb_id, ed.relation, ed.support_count,
                nb.entity_type, nb.canonical_name
         FROM public.edges ed
         JOIN public.entities nb ON nb.id = ed.${toCol}
         WHERE ed.${fromCol} = ANY($1::bigint[]) ${relFilter}
         ORDER BY ed.support_count DESC
         LIMIT ${limitClause * frontier.length + 50}`,
        params,
      );

      for (const row of hopRows as any[]) {
        const nbId = Number(row.nb_id);
        edges.push({ from_id: Number(row.src_id), to_id: nbId, relation: row.relation, support_count: Number(row.support_count) });
        if (!visited.has(nbId)) {
          visited.add(nbId);
          nodes.push({ id: nbId, entity_type: row.entity_type, entity_name: row.canonical_name });
          nextFrontier.push(nbId);
          if (nodes.length >= maxNodes) break;
        }
      }

      if (direction === "both") {
        const { rows: inRows } = await client.queryObject(
          `SELECT ed.to_entity_id AS src_id, ed.from_entity_id AS nb_id, ed.relation, ed.support_count,
                  nb.entity_type, nb.canonical_name
           FROM public.edges ed
           JOIN public.entities nb ON nb.id = ed.from_entity_id
           WHERE ed.to_entity_id = ANY($1::bigint[]) ${relFilter}
           ORDER BY ed.support_count DESC
           LIMIT ${Math.max(1, maxNodes - nodes.length) * frontier.length + 50}`,
          params,
        );
        for (const row of inRows as any[]) {
          const nbId = Number(row.nb_id);
          edges.push({ from_id: Number(row.src_id), to_id: nbId, relation: row.relation, support_count: Number(row.support_count) });
          if (!visited.has(nbId)) {
            visited.add(nbId);
            nodes.push({ id: nbId, entity_type: row.entity_type, entity_name: row.canonical_name });
            nextFrontier.push(nbId);
            if (nodes.length >= maxNodes) break;
          }
        }
      }

      frontier = nextFrontier;
    }

    return { nodes, edges };
  } finally { client.release(); }
}

export function registerTraverseKnowledgeGraphTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "traverse_knowledge_graph",
    "BFS traversal from a starting entity in OB1's knowledge graph. " +
    "Returns all reachable nodes and edges up to max_depth hops. " +
    "Use to discover cross-application patterns, e.g. which companies share required skills.",
    {
      start_entity_name: z.string().describe("Entity to start traversal from"),
      start_entity_type: z.string().optional().describe("Optional type to disambiguate start entity"),
      relation_types:    z.array(z.string()).optional().describe("Filter to specific relation types, e.g. ['requires','demonstrates']"),
      max_depth:         z.number().int().min(1).max(3).default(2),
      direction:         z.enum(["out", "in", "both"]).default("out"),
      limit:             z.number().int().min(1).max(200).default(50).describe("Max total nodes to return"),
    },
    async (args: TraverseGraphArgs) => {
      const result = await traverseKnowledgeGraphCore(pool, args);
      if (!result.nodes.length) {
        return { content: [{ type: "text", text: `No graph found from '${args.start_entity_name}'.` }] };
      }
      const summary = `Graph from '${args.start_entity_name}': ${result.nodes.length} nodes, ${result.edges.length} edges`;
      const nodeList = result.nodes.map(n => `  [${n.entity_type}] ${n.entity_name}`).join("\n");
      return { content: [{ type: "text", text: `${summary}\n\nNodes:\n${nodeList}` }] };
    },
  );
}

// ---------------------------------------------------------------------------
// listThoughtsCore — list thoughts from OB1's thoughts table with optional filters
// ---------------------------------------------------------------------------

export async function listThoughtsCore(
  pool: unknown,
  limit: number,
  type?: string,
  topic?: string,
  person?: string,
  days?: number,
): Promise<Array<{ id: string; content: string; metadata: Record<string, unknown>; created_at: string }>> {
  const p = pool as { connect(): Promise<{ queryObject<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>; release(): void }> };
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (type) {
    conditions.push(`metadata->>'type' = $${paramIdx}`);
    params.push(type);
    paramIdx++;
  }
  if (topic) {
    conditions.push(`metadata->'topics' ? $${paramIdx}`);
    params.push(topic);
    paramIdx++;
  }
  if (person) {
    conditions.push(`metadata->'people' ? $${paramIdx}`);
    params.push(person);
    paramIdx++;
  }
  if (days) {
    conditions.push(`created_at >= NOW() - INTERVAL '${Number(days)} days'`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const client = await p.connect();
  try {
    const result = await client.queryObject<{
      id: string; content: string; metadata: Record<string, unknown>; created_at: string;
    }>(
      `SELECT id::text AS id, content, metadata, created_at
       FROM thoughts
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIdx}`,
      [...params, limit],
    );
    return result.rows;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// registerCaptureThoughtTool — capture_thought with rich job-search metadata
// Exposes captureThoughtFn as a top-level MCP tool so Claude Code and the
// webapp can call it with structured fields instead of embedding YAML in content.
// ---------------------------------------------------------------------------

export function registerCaptureThoughtTool(server: unknown, captureThoughtFn?: CaptureThoughtFn) {
  (server as any).tool(
    "capture_thought",
    "Capture a thought in OB1 with structured job-search metadata. " +
    "Returns the thought ID for use in notes-index.md and knowledge graph edges. " +
    "Prefer this over mcp__open-brain__capture_thought in job-search sessions — " +
    "it passes metadata as proper fields rather than embedded YAML frontmatter.",
    {
      content: z.string().describe("Thought content to capture"),
      thought_category: z.string().optional().describe(
        "Category: jd_analysis | fit_assessment | domain_connection | company_research | " +
        "resume_strategy | resume_evaluation | interview_prep | email | application_event | achievement",
      ),
      source_type: z.string().optional().default("job_search"),
      application_id: z.string().optional().describe("Application UUID"),
      application_folder: z.string().optional().describe("Folder slug, e.g. '2026-05-27-wilson-sonsini-senior-ai-risk-advisor'"),
      company: z.string().optional(),
      profile_slug: z.string().optional(),
      extra_metadata: z.record(z.string(), z.unknown()).optional().describe("Any additional metadata fields"),
    },
    async (args: {
      content: string;
      thought_category?: string;
      source_type?: string;
      application_id?: string;
      application_folder?: string;
      company?: string;
      profile_slug?: string;
      extra_metadata?: Record<string, unknown>;
    }) => {
      if (!captureThoughtFn) {
        return { content: [{ type: "text", text: "capture_thought: captureThought callback not configured" }] };
      }
      const metadata: Record<string, unknown> = {
        source_type: args.source_type ?? "job_search",
        ...(args.thought_category ? { thought_category: args.thought_category } : {}),
        ...(args.application_id ? { application_id: args.application_id } : {}),
        ...(args.application_folder ? { application_folder: args.application_folder } : {}),
        ...(args.company ? { company: args.company } : {}),
        ...(args.profile_slug ? { profile_slug: args.profile_slug } : {}),
        ...(args.extra_metadata ?? {}),
      };
      try {
        const thoughtId = await captureThoughtFn(args.content, metadata);
        return { content: [{ type: "text", text: `Thought captured: ${thoughtId}` }] };
      } catch (err: unknown) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );
}

// ---------------------------------------------------------------------------
// registerSearchThoughtsTool — search_thoughts with thought IDs in output
// ---------------------------------------------------------------------------

export function registerSearchThoughtsTool(server: unknown, searchThoughtsFn?: SearchThoughtsFn) {
  (server as any).tool(
    "search_thoughts",
    "Semantically search OB1 thoughts. Returns thought ID in each result for use with reference or update operations.",
    {
      query: z.string().describe("What to search for"),
      limit: z.number().optional().default(10),
      type_filter: z.string().optional().describe("Optional: filter results by metadata.type post-query"),
      source_filter: z.string().optional().describe("Optional: filter by metadata.source"),
    },
    async (args: { query: string; limit: number; type_filter?: string; source_filter?: string }) => {
      if (!searchThoughtsFn) {
        return { content: [{ type: "text", text: "search_thoughts: searchThoughts callback not configured" }] };
      }
      const { query, limit, type_filter: typeFilter, source_filter: sourceFilter } = args;
      try {
        const filter: Record<string, unknown> = {};
        if (sourceFilter) filter.source = sourceFilter;
        let results = await searchThoughtsFn(query, limit, filter);
        if (typeFilter) {
          results = results.filter(t => String((t.metadata || {}).type || "") === typeFilter);
        }

        if (!results.length) {
          return { content: [{ type: "text", text: `No thoughts found matching "${query}".` }] };
        }

        const blocks = results.map((t, i) => {
          const m = (t.metadata || {}) as Record<string, unknown>;
          const parts = [
            `--- Result ${i + 1} (${(t.similarity * 100).toFixed(1)}% match) ---`,
            `ID: ${t.id}`,
            `Captured: ${new Date(t.created_at).toLocaleDateString()}`,
            `Type: ${String(m.type || "unknown")}`,
          ];
          if (Array.isArray(m.topics) && m.topics.length)
            parts.push(`Topics: ${(m.topics as string[]).join(", ")}`);
          if (Array.isArray(m.people) && m.people.length)
            parts.push(`People: ${(m.people as string[]).join(", ")}`);
          if (Array.isArray(m.action_items) && m.action_items.length)
            parts.push(`Actions: ${(m.action_items as string[]).join("; ")}`);
          parts.push(`\n${t.content}`);
          return parts.join("\n");
        });

        return {
          content: [{ type: "text", text: `Found ${results.length} thought(s):\n\n${blocks.join("\n\n")}` }],
        };
      } catch (err: unknown) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );
}

// ---------------------------------------------------------------------------
// registerListThoughtsTool — list_thoughts with thought IDs in output
// ---------------------------------------------------------------------------

export function registerListThoughtsTool(server: unknown, listThoughtsFn?: ListThoughtsFn) {
  (server as any).tool(
    "list_thoughts",
    "List recently captured thoughts with optional filters. Returns thought IDs for reference operations.",
    {
      limit: z.number().optional().default(10),
      type: z.string().optional().describe("Filter by type: observation, task, idea, reference, person_note"),
      topic: z.string().optional().describe("Filter by topic tag"),
      person: z.string().optional().describe("Filter by person mentioned"),
      days: z.number().optional().describe("Only thoughts from the last N days"),
    },
    async (args: { limit: number; type?: string; topic?: string; person?: string; days?: number }) => {
      if (!listThoughtsFn) {
        return { content: [{ type: "text", text: "list_thoughts: listThoughts callback not configured" }] };
      }
      const { limit, type, topic, person, days } = args;
      try {
        const rows = await listThoughtsFn(limit, type, topic, person, days);

        if (!rows.length) {
          return { content: [{ type: "text", text: "No thoughts found." }] };
        }

        const entries = rows.map((t, i) => {
          const m = (t.metadata || {}) as Record<string, unknown>;
          const tags = Array.isArray(m.topics) ? (m.topics as string[]).join(", ") : "";
          return `${i + 1}. [${new Date(t.created_at).toLocaleDateString()}] (${String(m.type || "??")}${tags ? " - " + tags : ""}) [id:${t.id}]\n   ${t.content}`;
        });

        return {
          content: [{ type: "text", text: `${rows.length} recent thought(s):\n\n${entries.join("\n\n")}` }],
        };
      } catch (err: unknown) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );
}

// ---------------------------------------------------------------------------
// OB1 compatibility tools — absorbed from OB1 MCP server
// These replace mcp__open-brain__* with mcp__job-search__* equivalents so that
// only one MCP server is needed. All thought IDs are returned as strings (::text
// cast) to avoid BigInt serialization errors from the BIGSERIAL id column.
// ---------------------------------------------------------------------------

function ob1ThoughtTitle(content: string, createdAt?: string): string {
  const firstLine = content.replace(/\s+/g, " ").trim().slice(0, 80);
  const datePrefix = createdAt ? new Date(createdAt).toLocaleDateString() : "Open Brain";
  return firstLine ? `${datePrefix} - ${firstLine}` : `${datePrefix} thought`;
}

function ob1ThoughtUrl(id: string): string {
  return `${CITATION_BASE_URL.replace(/\/$/, "")}/${id}`;
}

export function registerSearchTool(server: unknown, pool: unknown, embedQueryFn?: EmbedQueryFn) {
  (server as any).tool(
    "search",
    "Search Open Brain memories by meaning. Read-only ChatGPT-connector-compatible tool; pair with fetch to retrieve full content.",
    {
      query: z.string().describe("The search query to run against Open Brain thoughts"),
    },
    async ({ query }: { query: string }) => {
      if (!embedQueryFn) {
        return { content: [{ type: "text", text: "search: embedQuery callback not configured" }] };
      }
      const p = pool as { connect(): Promise<{ queryObject<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>; release(): void }> };
      try {
        const qEmb = await embedQueryFn(query);
        const embStr = `[${qEmb.join(",")}]`;
        const client = await p.connect();
        try {
          const result = await client.queryObject<{ id: string; content: string; created_at: string }>(
            `SELECT id::text AS id, content, created_at
             FROM thoughts
             WHERE 1 - (embedding <=> $1::vector) >= 0.5
             ORDER BY embedding <=> $1::vector
             LIMIT $2`,
            [embStr, 10],
          );
          const results = result.rows.map((t) => ({
            id: t.id,
            title: ob1ThoughtTitle(t.content, t.created_at),
            url: ob1ThoughtUrl(t.id),
          }));
          return { content: [{ type: "text", text: JSON.stringify({ results }) }] };
        } finally {
          client.release();
        }
      } catch (err: unknown) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );
}

export function registerFetchTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "fetch",
    "Fetch one Open Brain thought by ID. Use after search to retrieve full text and metadata for citation.",
    {
      id: z.string().describe("The thought ID returned by the search tool"),
    },
    async ({ id }: { id: string }) => {
      const p = pool as { connect(): Promise<{ queryObject<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>; release(): void }> };
      try {
        const client = await p.connect();
        try {
          const result = await client.queryObject<{
            id: string; content: string; metadata: Record<string, unknown>;
            created_at: string; updated_at: string | null;
          }>(
            `SELECT id::text AS id, content, metadata, created_at, updated_at
             FROM thoughts
             WHERE id = $1
             LIMIT 1`,
            [id],
          );
          const thought = result.rows[0];
          if (!thought) {
            return { content: [{ type: "text", text: `No thought found for ID ${id}.` }], isError: true };
          }
          const document = {
            id: thought.id,
            title: ob1ThoughtTitle(thought.content, thought.created_at),
            text: thought.content,
            url: ob1ThoughtUrl(thought.id),
            metadata: {
              ...thought.metadata,
              created_at: thought.created_at,
              updated_at: thought.updated_at,
            },
          };
          return { content: [{ type: "text", text: JSON.stringify(document) }] };
        } finally {
          client.release();
        }
      } catch (err: unknown) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );
}

export function registerThoughtStatsTool(server: unknown, pool: unknown) {
  (server as any).tool(
    "thought_stats",
    "Get a summary of all captured thoughts: total count, type breakdown, top topics, and people mentioned.",
    {},
    async () => {
      const p = pool as { connect(): Promise<{ queryObject<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>; release(): void }> };
      try {
        const client = await p.connect();
        try {
          const countResult = await client.queryObject<{ count: number }>(
            "SELECT COUNT(*)::int AS count FROM thoughts",
          );
          const dataResult = await client.queryObject<{
            metadata: Record<string, unknown>; created_at: string;
          }>(
            "SELECT metadata, created_at FROM thoughts ORDER BY created_at DESC",
          );

          const count = countResult.rows[0]?.count ?? 0;
          const data = dataResult.rows;
          const types: Record<string, number> = {};
          const topics: Record<string, number> = {};
          const people: Record<string, number> = {};

          for (const r of data) {
            const m = r.metadata || {};
            if (m.type) types[m.type as string] = (types[m.type as string] || 0) + 1;
            if (Array.isArray(m.topics))
              for (const t of m.topics) topics[t as string] = (topics[t as string] || 0) + 1;
            if (Array.isArray(m.people))
              for (const per of m.people) people[per as string] = (people[per as string] || 0) + 1;
          }

          const sort = (o: Record<string, number>): [string, number][] =>
            Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 10);

          const lines: string[] = [
            `Total thoughts: ${count}`,
            `Date range: ${
              data.length
                ? new Date(data[data.length - 1].created_at).toLocaleDateString() +
                  " -> " + new Date(data[0].created_at).toLocaleDateString()
                : "N/A"
            }`,
            "",
            "Types:",
            ...sort(types).map(([k, v]) => `  ${k}: ${v}`),
          ];
          if (Object.keys(topics).length) {
            lines.push("", "Top topics:");
            for (const [k, v] of sort(topics)) lines.push(`  ${k}: ${v}`);
          }
          if (Object.keys(people).length) {
            lines.push("", "People mentioned:");
            for (const [k, v] of sort(people)) lines.push(`  ${k}: ${v}`);
          }

          return { content: [{ type: "text", text: lines.join("\n") }] };
        } finally {
          client.release();
        }
      } catch (err: unknown) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );
}

export function registerJobSearchTools(server: unknown, pool: unknown, callbacks: JobSearchCallbacks = {}) {
  const { captureThought, searchThoughts, listThoughts, embedQuery, chunkContent } = callbacks;

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
  registerUpdateSearchRunTool(server, pool);
  registerGetSearchRunsTool(server, pool);
  registerSearchApplicationsSemanticTool(server, pool, searchThoughts);

  // Phase 2: section-level chunk search
  registerSearchChunksSemanticTool(server, pool, embedQuery);

  // Phase 3: structured metadata + cross-app pattern matching
  registerUpdateApplicationFieldsTool(server, pool);
  registerFindSimilarApplicationsTool(server, pool, embedQuery);

  // Phase 3: Knowledge Map — explicit entity graph edges
  registerCreateKnowledgeEdgeTool(server, pool);
  registerGetEntityNeighborsTool(server, pool);
  registerTraverseKnowledgeGraphTool(server, pool);

  // Thought tools (capture + query; job-search variants include thought IDs in output)
  registerCaptureThoughtTool(server, captureThought);
  registerSearchThoughtsTool(server, searchThoughts);
  registerListThoughtsTool(server, listThoughts);

  // OB1 compatibility tools (absorbed from OB1 MCP server — eliminates open-brain dependency)
  registerSearchTool(server, pool, embedQuery);
  registerFetchTool(server, pool);
  registerThoughtStatsTool(server, pool);

  // Ingest tracking tools (Phase 1 — replaces seen-jobs.json)
  registerCheckPositionSeenTool(server, pool);
  registerLogIngestedPositionTool(server, pool);
  registerGetIngestionHistoryTool(server, pool);
}
