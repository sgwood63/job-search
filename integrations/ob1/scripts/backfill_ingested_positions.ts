/**
 * backfill_ingested_positions.ts — One-time migration script
 *
 * Populates js_ingested_positions from OB1 data:
 *   Phase 1 — js_applications → outcome='fit' rows (one per existing application)
 *   Phase 2 — MinIO search summary .md files → outcome='no-fit'/'fetch-failed' rows
 *
 * Run after js_ingested_positions table is deployed:
 *   deno run --allow-net --allow-env \
 *     integrations/ob1/scripts/backfill_ingested_positions.ts
 *
 * Safe to re-run: idempotent (SELECT-before-INSERT on company+role; ON CONFLICT DO NOTHING for fit rows).
 */

import { Pool } from "postgres";
import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

// --- Config ---

const DB_HOST     = Deno.env.get("DB_HOST")     || "127.0.0.1";
const DB_PORT     = parseInt(Deno.env.get("DB_PORT") || "5432", 10);
const DB_NAME     = Deno.env.get("DB_NAME")     || "openbrain";
const DB_USER     = Deno.env.get("DB_USER")     || "postgres";
const DB_PASSWORD = Deno.env.get("DB_PASSWORD")!;

const MINIO_ENDPOINT   = Deno.env.get("MINIO_ENDPOINT") || "minio.openbrain.svc.cluster.local:9000";
const MINIO_ACCESS_KEY = Deno.env.get("MINIO_ACCESS_KEY")!;
const MINIO_SECRET_KEY = Deno.env.get("MINIO_SECRET_KEY")!;
const BUCKET           = Deno.env.get("MINIO_BUCKET") || "job-search";

// --- Clients ---

const pool = new Pool(
  { hostname: DB_HOST, port: DB_PORT, database: DB_NAME, user: DB_USER, password: DB_PASSWORD },
  3,
);

const s3 = new S3Client({
  region: "us-east-1",
  endpoint: `http://${MINIO_ENDPOINT}`,
  credentials: { accessKeyId: MINIO_ACCESS_KEY, secretAccessKey: MINIO_SECRET_KEY },
  forcePathStyle: true,
});

// --- Helpers ---

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
    console.warn(`  SKIP (S3 fetch failed): ${(e as Error).message}`);
    return null;
  }
}

async function listSummaryKeys(): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: "search/",
      ContinuationToken: token,
    }));
    for (const obj of res.Contents ?? []) {
      if (obj.Key?.endsWith("-summary.md")) keys.push(obj.Key);
    }
    token = res.NextContinuationToken;
  } while (token);
  return keys.sort();
}

function parseTableRow(line: string): string[] {
  return line.split("|").slice(1, -1).map(cell => cell.trim());
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line);
}

// Extract profile slug from summary filename.
// Handles both date formats:
//   YYYY-MM-DD-HHMMSS-<profile>-summary.md
//   YYYYMMDD-HHMMSS-<profile>-summary.md
function profileFromKey(key: string): string {
  const filename = key.split("/").pop()!.replace(/-summary\.md$/, "");
  const parts = filename.split("-");
  // Find the 6-digit time segment (HHMMSS) — everything after it is the profile
  const timeIdx = parts.findIndex(p => /^\d{6}$/.test(p));
  if (timeIdx >= 0) return parts.slice(timeIdx + 1).join("-");
  // Fallback: strip leading YYYYMMDD-HHMMSS-
  return filename.replace(/^\d{8}-\d{6}-/, "");
}

// Extract YYYY-MM-DD from summary filename
function dateFromKey(key: string): string {
  const filename = key.split("/").pop()!;
  const m = filename.match(/^(\d{4})-(\d{2})-(\d{2})-\d{6}-/)
         || filename.match(/^(\d{4})(\d{2})(\d{2})-\d{6}-/);
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// Build no_fit_reason string from raw score cell and reason text.
// Score column may be: "2", "2/10", "0", "no-fit", "" — normalize gracefully.
function buildReason(rawScore: string, reasonText: string): string | null {
  const score = rawScore.trim();
  let normalizedScore: string | null = null;
  if (/^\d+$/.test(score)) normalizedScore = `${score}/10`;
  else if (/^\d+\/\d+$/.test(score)) normalizedScore = score;
  // Non-numeric scores ("no-fit", "N/A") → omit from reason string
  return normalizedScore
    ? `score ${normalizedScore}: ${reasonText}`.trim() || null
    : (reasonText.trim() || null);
}

interface ParsedRow {
  company_name: string;
  role_title: string;
  outcome: "no-fit" | "fetch-failed";
  no_fit_reason: string | null;
}

// Parse a summary .md file and return all non-fit rows from the relevant sections.
// Fit Jobs section is intentionally skipped — Phase 1 handles those via js_applications.
function parseSummaryFile(content: string): ParsedRow[] {
  const result: ParsedRow[] = [];

  // Split on H2 headings (the leading "## " was the split token, so heading is the first line)
  const sections = content.split(/^## /m);

  for (const section of sections) {
    const lines = section.split("\n");
    const heading = lines[0].trim();

    let outcome: "no-fit" | "fetch-failed";
    let columnCount: number;

    if (/^No-Fit Jobs?/i.test(heading)) {
      outcome = "no-fit";
      columnCount = 5; // Company | Role | Location | Score | Reason
    } else if (/^Hard Stops?/i.test(heading)) {
      outcome = "no-fit";
      columnCount = 3; // Company | Role | Hard Stop Reason
    } else if (/^Failed to Fetch/i.test(heading)) {
      outcome = "fetch-failed";
      columnCount = 4; // Company | Role | Location | Reason
    } else {
      continue; // skip Fit Jobs, Sub-queries, Notes, etc.
    }

    for (const line of lines.slice(1)) {
      if (!line.startsWith("|")) continue;
      if (isSeparatorRow(line)) continue;

      const cells = parseTableRow(line);
      if (cells.length < 2) continue;

      const company_name = cells[0];
      const role_title = cells[1];

      if (!company_name || !role_title) continue;
      if (company_name.toLowerCase() === "company") continue; // header row
      if (company_name.startsWith("_")) continue;             // _Note: lines

      let no_fit_reason: string | null = null;

      if (outcome === "no-fit" && columnCount === 5) {
        no_fit_reason = buildReason(cells[3] ?? "", cells[4] ?? "");
      } else if (outcome === "no-fit" && columnCount === 3) {
        const reason = (cells[2] ?? "").trim();
        no_fit_reason = reason ? `hard stop: ${reason}` : null;
      } else if (outcome === "fetch-failed") {
        const reason = (cells[columnCount - 1] ?? "").trim();
        no_fit_reason = reason ? `fetch failed: ${reason}` : null;
      }

      result.push({ company_name, role_title, outcome, no_fit_reason });
    }
  }

  return result;
}

// --- Phase 1: Fit positions from js_applications ---

async function phase1(validSlugs: Set<string>): Promise<void> {
  console.log("\n=== Phase 1: Fit positions from js_applications ===");

  const init = await pool.connect();
  const { rows: apps } = await init.queryObject<{
    id: string;
    company_name: string;
    role_title: string;
    source_url: string | null;
    folder_prefix: string | null;
    created_at: string;
    profile_slug: string | null;
  }>(
    `SELECT a.id::text                          AS id,
            COALESCE(a.company_name_raw, co.name) AS company_name,
            a.role_title,
            a.source_url,
            a.folder_prefix,
            a.created_at::text                  AS created_at,
            p.slug                              AS profile_slug
     FROM js_applications a
     LEFT JOIN js_profiles p  ON p.id  = a.profile_id
     LEFT JOIN js_companies co ON co.id = a.company_id
     ORDER BY a.created_at`,
  );
  init.release();

  console.log(`Found ${apps.length} applications`);
  let inserted = 0, skipped = 0;

  for (const app of apps) {
    const c = await pool.connect();
    try {
      // Idempotent guard
      const { rows: existing } = await c.queryObject(
        `SELECT 1 FROM js_ingested_positions WHERE application_id = $1::uuid LIMIT 1`,
        [app.id],
      );
      if (existing.length > 0) { skipped++; continue; }

      const sourceUrl = (app.source_url && app.source_url !== "Pasted" && app.source_url.trim() !== "")
        ? app.source_url : null;

      const profileSlug = (app.profile_slug && validSlugs.has(app.profile_slug))
        ? app.profile_slug : null;

      // Match search_run_id by date extracted from folder_prefix + profile
      let searchRunId: string | null = null;
      if (app.folder_prefix && app.profile_slug) {
        const m = app.folder_prefix.match(/applications\/(\d{4}-\d{2}-\d{2})/);
        const folderDate = m?.[1];
        if (folderDate) {
          const { rows: runs } = await c.queryObject<{ id: string }>(
            `SELECT sr.id::text AS id
             FROM js_search_runs sr
             JOIN js_profiles p ON p.id = sr.profile_id
             WHERE p.slug = $1 AND DATE(sr.run_at) = $2::date
             LIMIT 1`,
            [app.profile_slug, folderDate],
          );
          searchRunId = runs[0]?.id ?? null;
        }
      }

      await c.queryObject(
        `INSERT INTO js_ingested_positions
           (source_url, company_name, role_title, profile_slug, search_run_id,
            application_id, outcome, is_repost, first_seen_at, created_at)
         VALUES ($1, $2, $3, $4, $5::uuid, $6::uuid, 'fit', false,
                 $7::timestamptz, $7::timestamptz)
         ON CONFLICT DO NOTHING`,
        [sourceUrl, app.company_name, app.role_title, profileSlug,
         searchRunId, app.id, app.created_at],
      );

      console.log(`  ✓ ${app.company_name} — ${app.role_title}`);
      inserted++;
    } catch (e) {
      console.error(`  ERROR (${app.company_name}): ${(e as Error).message}`);
    } finally {
      c.release();
    }
  }

  console.log(`Phase 1 done: ${inserted} inserted, ${skipped} already existed`);
}

// --- Phase 2: No-fit/fetch-failed from MinIO summary files ---

async function phase2(validSlugs: Set<string>): Promise<void> {
  console.log("\n=== Phase 2: No-fit / fetch-failed from MinIO summary files ===");

  const keys = await listSummaryKeys();
  console.log(`Found ${keys.length} summary files`);

  let totalInserted = 0, totalSkipped = 0;

  for (const key of keys) {
    console.log(`\n  ${key}`);

    const content = await fetchText(key);
    if (!content) continue;

    const profileFromFile = profileFromKey(key);
    const dateStr = dateFromKey(key);
    const profileSlug = validSlugs.has(profileFromFile) ? profileFromFile : null;

    if (!profileSlug) {
      console.log(`  profile '${profileFromFile}' not in js_profiles — profile_slug will be null`);
    }

    // Resolve search_run_id: try summary_key FK first, fall back to date+profile
    let searchRunId: string | null = null;
    let runAt: string | null = null;
    {
      const c = await pool.connect();
      try {
        const { rows } = await c.queryObject<{ id: string; run_at: string }>(
          `SELECT id::text AS id, run_at::text AS run_at
           FROM js_search_runs WHERE summary_key = $1 LIMIT 1`,
          [key],
        );
        if (rows.length > 0) {
          ({ id: searchRunId, run_at: runAt } = rows[0]);
        } else if (dateStr) {
          const { rows: r2 } = await c.queryObject<{ id: string; run_at: string }>(
            `SELECT sr.id::text AS id, sr.run_at::text AS run_at
             FROM js_search_runs sr
             LEFT JOIN js_profiles p ON p.id = sr.profile_id
             WHERE DATE(sr.run_at) = $1::date
               AND ($2::text IS NULL OR p.slug = $2)
             LIMIT 1`,
            [dateStr, profileSlug],
          );
          if (r2.length > 0) ({ id: searchRunId, run_at: runAt } = r2[0]);
        }
      } finally {
        c.release();
      }
    }

    console.log(searchRunId
      ? `  → search_run ${searchRunId.slice(0, 8)}… (run_at: ${runAt})`
      : `  → no search_run match (search_run_id=null)`);

    const rows = parseSummaryFile(content);
    console.log(`  Parsed ${rows.length} non-fit entries`);

    let inserted = 0, skipped = 0;

    for (const row of rows) {
      const c = await pool.connect();
      try {
        // Idempotent: skip if company+role already exists in any outcome
        const { rows: existing } = await c.queryObject(
          `SELECT 1 FROM js_ingested_positions
           WHERE lower(company_name) = lower($1) AND lower(role_title) = lower($2)
           LIMIT 1`,
          [row.company_name, row.role_title],
        );
        if (existing.length > 0) { skipped++; continue; }

        await c.queryObject(
          `INSERT INTO js_ingested_positions
             (source_url, company_name, role_title, profile_slug, search_run_id,
              outcome, no_fit_reason, is_repost, first_seen_at, created_at)
           VALUES (null, $1, $2, $3, $4::uuid, $5, $6, false,
                   $7::timestamptz, $7::timestamptz)`,
          [row.company_name, row.role_title, profileSlug, searchRunId,
           row.outcome, row.no_fit_reason, runAt ?? new Date().toISOString()],
        );
        inserted++;
      } catch (e) {
        console.error(`    ERROR (${row.company_name}): ${(e as Error).message}`);
      } finally {
        c.release();
      }
    }

    console.log(`  ${inserted} inserted, ${skipped} skipped (already existed)`);
    totalInserted += inserted;
    totalSkipped += skipped;
  }

  console.log(`\nPhase 2 done: ${totalInserted} inserted, ${totalSkipped} skipped`);
}

// --- Main ---

const initClient = await pool.connect();
const { rows: profileRows } = await initClient.queryObject<{ slug: string }>(
  `SELECT slug FROM js_profiles WHERE slug IS NOT NULL`,
);
initClient.release();

const validSlugs = new Set(profileRows.map(r => r.slug));
console.log(`Valid profile slugs: ${[...validSlugs].join(", ")}`);

await phase1(validSlugs);
await phase2(validSlugs);

await pool.end();
console.log("\nBackfill complete.");
