/**
 * backfill_search_runs.ts — One-time migration script
 *
 * Populates js_search_runs and js_ingested_positions from OB1 summary .md files.
 * Uses only the OB1 REST API — no direct Postgres or MinIO access.
 *
 * Run after js_search_runs and js_ingested_positions tables are deployed
 * AND after the OB1 server is redeployed with the new REST endpoints:
 *   GET  /api/v2/search-runs
 *   POST /api/v2/search-runs
 *   POST /api/v2/ingested-positions
 *
 * Usage:
 *   OB1_BASE_URL=http://localhost:8001 \
 *   OB1_API_KEY=your-key \
 *   deno run --allow-net --allow-env \
 *     integrations/ob1/scripts/backfill_search_runs.ts
 *
 * Safe to re-run: idempotency check compares run_at timestamp within 60 seconds.
 */

const BASE_URL = (Deno.env.get("OB1_BASE_URL") || "http://localhost:8001").replace(/\/$/, "");
const API_KEY  = Deno.env.get("OB1_API_KEY") || "";

if (!API_KEY) {
  console.error("OB1_API_KEY is required");
  Deno.exit(1);
}

const HEADERS = {
  "x-brain-key": API_KEY,
  "Content-Type": "application/json",
};

// ---------------------------------------------------------------------------
// REST API helpers
// ---------------------------------------------------------------------------

async function listFiles(prefix: string): Promise<Array<{ key: string; size: number }>> {
  const r = await fetch(`${BASE_URL}/api/v2/files?prefix=${encodeURIComponent(prefix)}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`listFiles failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function readFile(key: string): Promise<string> {
  const r = await fetch(`${BASE_URL}/api/v2/files/${encodeURIComponent(key)}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`readFile(${key}) failed: ${r.status}`);
  return r.text();
}

async function getSearchRuns(profileSlug: string | null, since: string): Promise<Array<{ id: string; run_at: string }>> {
  const params = new URLSearchParams({ limit: "10", since });
  if (profileSlug) params.set("profile_slug", profileSlug);
  const r = await fetch(`${BASE_URL}/api/v2/search-runs?${params}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`getSearchRuns failed: ${r.status}`);
  return r.json();
}

async function postSearchRun(args: {
  profile_slug: string;
  query: string;
  pages_fetched: number;
  total_results: number;
  new_after_dedup: number;
  screened: number;
  fit_count: number;
  summary_key: string;
}): Promise<string> {
  const r = await fetch(`${BASE_URL}/api/v2/search-runs`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`postSearchRun failed: ${r.status} ${await r.text()}`);
  const data = await r.json();
  return data.id as string;
}

async function postIngestedPosition(args: {
  company_name: string;
  role_title: string;
  profile_slug: string | null;
  search_run_id: string;
  outcome: "fit" | "no-fit" | "fetch-failed";
  no_fit_reason?: string | null;
  source_url?: string | null;
}): Promise<void> {
  const r = await fetch(`${BASE_URL}/api/v2/ingested-positions`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(args),
  });
  if (r.status === 409) return; // duplicate — skip silently
  if (!r.ok) throw new Error(`postIngestedPosition failed: ${r.status} ${await r.text()}`);
}

// ---------------------------------------------------------------------------
// Summary .md parser
// ---------------------------------------------------------------------------

interface RunHeader {
  profile_slug: string;
  query: string;
  run_at: string; // ISO timestamp
  pages_fetched: number;
  total_results: number;
  new_after_dedup: number;
  screened: number;
  fit_count: number;
}

interface PositionRow {
  company: string;
  role: string;
  outcome: "fit" | "no-fit" | "fetch-failed";
  reason?: string;
}

function parseField(lines: string[], label: string): string {
  const prefix = `**${label}:**`;
  const line = lines.find(l => l.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : "";
}

function parseRunAt(dateStr: string): string {
  // "2026-05-01 12:00:00" → "2026-05-01T12:00:00"
  return dateStr.replace(" ", "T");
}

function parseTable(content: string, sectionHeader: string): string[][] {
  const idx = content.indexOf(`## ${sectionHeader}`);
  if (idx === -1) return [];
  const section = content.slice(idx);
  const lines = section.split("\n");
  const rows: string[][] = [];
  let inTable = false;
  for (const line of lines) {
    if (line.startsWith("|") && !line.match(/^\|\s*[-:]+\s*\|/)) {
      if (!inTable) { inTable = true; continue; } // skip header row
      const cells = line.split("|").slice(1, -1).map(c => c.trim());
      if (cells.length > 0) rows.push(cells);
    } else if (inTable && !line.startsWith("|") && line.trim() !== "") {
      break; // end of table
    }
  }
  return rows;
}

function parseSummaryMd(
  content: string,
  fileKey: string,
): { header: RunHeader; positions: PositionRow[] } | null {
  const lines = content.split("\n");

  // Profile from filename: search/YYYY-MM-DD-HHMMSS-<profile>-summary.md
  const match = fileKey.match(/search\/\d{4}-\d{2}-\d{2}-\d{6}-(.+)-summary\.md$/);
  const profile_slug = match ? match[1] : parseField(lines, "Profile") || "unknown";

  const dateStr = parseField(lines, "Date");
  if (!dateStr) return null;

  const pages_fetched  = parseInt(parseField(lines, "Pages fetched"), 10) || 0;
  const total_results  = parseInt(parseField(lines, "Total results"), 10) || 0;
  const new_after_dedup = parseInt(parseField(lines, "New (deduped)"), 10) || 0;
  const screened       = parseInt(parseField(lines, "Screened"), 10) || 0;
  const fit_count      = parseInt(parseField(lines, "Fit"), 10) || 0;

  // Build query from Sub-queries section
  const subIdx = content.indexOf("## Sub-queries");
  let query = profile_slug;
  if (subIdx !== -1) {
    const subSection = content.slice(subIdx + "## Sub-queries".length);
    const subLines = subSection.split("\n").slice(1);
    const queryLines: string[] = [];
    for (const l of subLines) {
      if (l.startsWith("##")) break;
      const cleaned = l.replace(/^\d+\.\s*/, "").trim();
      if (cleaned) queryLines.push(cleaned);
    }
    if (queryLines.length > 0) query = queryLines.join(" | ");
  }

  // Parse position tables
  const positions: PositionRow[] = [];

  for (const row of parseTable(content, "Fit Jobs (score >= 7)")) {
    if (row[0] && row[0] !== "_No fit jobs found._") {
      positions.push({ company: row[0], role: row[1] ?? "", outcome: "fit" });
    }
  }

  for (const row of parseTable(content, "No-Fit Jobs")) {
    if (row[0] && row[0] !== "_No no-fit jobs._") {
      const reason = row[4] ?? row[3] ?? "";
      positions.push({ company: row[0], role: row[1] ?? "", outcome: "no-fit", reason });
    }
  }

  for (const row of parseTable(content, "Failed to Fetch")) {
    if (row[0] && row[0] !== "_No fetch failures._") {
      const reason = row[3] ?? row[2] ?? "";
      positions.push({ company: row[0], role: row[1] ?? "", outcome: "fetch-failed", reason });
    }
  }

  return {
    header: {
      profile_slug,
      query,
      run_at: parseRunAt(dateStr),
      pages_fetched,
      total_results,
      new_after_dedup,
      screened,
      fit_count,
    },
    positions,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Connecting to OB1 at ${BASE_URL} …`);

  const allFiles = await listFiles("search/");
  const summaryFiles = allFiles
    .filter(f => f.key.endsWith("-summary.md"))
    .sort((a, b) => a.key.localeCompare(b.key)); // chronological

  console.log(`Found ${summaryFiles.length} summary file(s) to process.\n`);

  let created = 0, skipped = 0, positions = 0, errors = 0;

  for (const file of summaryFiles) {
    try {
      const content = await readFile(file.key);
      const parsed = parseSummaryMd(content, file.key);

      if (!parsed) {
        console.warn(`  [SKIP] ${file.key} — could not parse header`);
        skipped++;
        continue;
      }

      const { header, positions: posRows } = parsed;

      // Idempotency: look for an existing run within 60 seconds of the parsed timestamp
      const runAtDate = new Date(header.run_at);
      const sinceIso = new Date(runAtDate.getTime() - 90_000).toISOString(); // 90s before
      const existing = await getSearchRuns(header.profile_slug, sinceIso);
      const already = existing.some(r => {
        return Math.abs(new Date(r.run_at).getTime() - runAtDate.getTime()) < 60_000;
      });

      if (already) {
        console.log(`  [SKIP] ${file.key} — run already exists`);
        skipped++;
        continue;
      }

      const runId = await postSearchRun({
        profile_slug: header.profile_slug,
        query: header.query,
        pages_fetched: header.pages_fetched,
        total_results: header.total_results,
        new_after_dedup: header.new_after_dedup,
        screened: header.screened,
        fit_count: header.fit_count,
        summary_key: file.key,
      });
      created++;

      for (const pos of posRows) {
        await postIngestedPosition({
          company_name: pos.company,
          role_title: pos.role,
          profile_slug: header.profile_slug,
          search_run_id: runId,
          outcome: pos.outcome,
          no_fit_reason: pos.reason ?? null,
        });
        positions++;
      }

      console.log(`  [OK]   ${file.key} — run ${runId.slice(0, 8)} — ${posRows.length} positions`);
    } catch (err) {
      console.error(`  [ERROR] ${file.key}:`, (err as Error).message);
      errors++;
    }
  }

  console.log(`\nDone: ${created} runs created, ${skipped} skipped, ${positions} positions inserted, ${errors} errors`);
  if (errors > 0) Deno.exit(1);
}

main().catch(err => {
  console.error("Fatal:", err);
  Deno.exit(1);
});
