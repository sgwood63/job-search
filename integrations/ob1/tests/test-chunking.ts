/**
 * Unit tests for Phase 2 chunking MCP tool core functions:
 *   chunkMarkdown, searchChunksSemanticCore
 *
 * Run from integrations/ob1/:
 *   deno test --allow-env --allow-sys tests/test-chunking.ts
 *
 * All database I/O is mocked — no live Postgres connection required.
 */
import { assert, assertEquals } from "jsr:@std/assert";
import { chunkMarkdown, searchChunksSemanticCore } from "../job-search-tools.ts";

// ---------------------------------------------------------------------------
// Mock helpers (same pattern as test-knowledge-graph.ts)
// ---------------------------------------------------------------------------

function makeMockPool(sequence: Array<{ rows: unknown[] }>) {
  let i = 0;
  const client = {
    queryObject: (_sql: string, _params?: unknown[]) =>
      Promise.resolve(sequence[i++] ?? { rows: [] }),
    release: () => {},
  };
  return { connect: () => Promise.resolve(client) };
}

function makeSpy(sequence: Array<{ rows: unknown[] }>) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    queryObject: (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return Promise.resolve(sequence[calls.length - 1] ?? { rows: [] });
    },
    release: () => {},
  };
  const pool = { connect: () => Promise.resolve(client) };
  return { pool, calls };
}

const mockEmbedFn = async (_q: string) => [0.1, 0.2, 0.3];

// ===========================================================================
// chunkMarkdown
// ===========================================================================

Deno.test("chunkMarkdown — splits on H2 boundaries, returns two chunks with correct titles", () => {
  const doc =
    "## Introduction\n\nSome intro text that is long enough to survive the minimum chunk filter.\n\n" +
    "## Methods\n\nMore detailed methods content here that is also long enough to pass the filter.";
  const chunks = chunkMarkdown(doc);
  assertEquals(chunks.length, 2);
  assertEquals(chunks[0].title, "Introduction");
  assertEquals(chunks[0].index, 0);
  assertEquals(chunks[1].title, "Methods");
  assertEquals(chunks[1].index, 1);
});

Deno.test("chunkMarkdown — preamble before first H2 gets title: null", () => {
  const doc =
    "This is preamble text that is definitely long enough to not be filtered out by the 30-char minimum.\n\n" +
    "## First Section\n\nSection content here that is long enough to count.";
  const chunks = chunkMarkdown(doc);
  assertEquals(chunks.length, 2);
  assertEquals(chunks[0].title, null);
  assertEquals(chunks[1].title, "First Section");
});

Deno.test("chunkMarkdown — sections shorter than 30 chars are skipped", () => {
  const doc =
    "## Tiny\n\nOk\n\n" +
    "## Real Section\n\nThis is a real section with enough content to not be skipped by the minimum length filter.";
  const chunks = chunkMarkdown(doc);
  // "## Tiny\n\nOk" is well under 30 chars and gets dropped
  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].title, "Real Section");
});

Deno.test("chunkMarkdown — returns empty array for empty input", () => {
  assertEquals(chunkMarkdown(""), []);
});

Deno.test("chunkMarkdown — indices are global and sequential across sections", () => {
  const doc = [
    "Preamble content that is long enough to survive the minimum chunk filter check in the algorithm.",
    "## Section A",
    "Content for section A which is long enough to pass the minimum chunk size filter in the function.",
    "## Section B",
    "Content for section B which is long enough to pass the minimum chunk size filter in the function.",
  ].join("\n\n");
  const chunks = chunkMarkdown(doc);
  assertEquals(chunks.length, 3);
  assertEquals(chunks[0].index, 0);
  assertEquals(chunks[1].index, 1);
  assertEquals(chunks[2].index, 2);
});

Deno.test("chunkMarkdown — oversized H2 section (>8000 chars) splits into sub-chunks with 'continued' suffix", () => {
  // Four paragraphs of ~2500 chars each → ~10000 chars total, well above MAX_CHUNK=8000
  const para = "word ".repeat(500); // 2500 chars
  const bigContent = [para, para, para, para].join("\n\n");
  const doc = `## Big Section\n\n${bigContent}`;
  const chunks = chunkMarkdown(doc);
  assert(chunks.length >= 2, `expected >=2 sub-chunks for oversized section, got ${chunks.length}`);
  // First sub-chunk keeps the original title
  assertEquals(chunks[0].title, "Big Section");
  // Continuation sub-chunks use the "(continued N)" suffix
  assertEquals(chunks[1].title, "Big Section (continued 1)");
});

Deno.test("chunkMarkdown — headerless section >1500 chars splits even when under 8000 chars", () => {
  // Three paragraphs of ~600 chars each with no ## headers → ~1800 chars total.
  // Triggers the PARA_SPLIT_SIZE=1500 guard for headerless (verbatim JD) content.
  const para = "x ".repeat(300); // 600 chars
  const doc = [para, para, para].join("\n\n"); // ~1800 chars, no headers
  const chunks = chunkMarkdown(doc);
  assert(chunks.length >= 2, `expected >=2 chunks for large headerless doc, got ${chunks.length}`);
  assertEquals(chunks[0].title, null);
  // Continuation of a null-title section uses the "…" placeholder
  assertEquals(chunks[1].title, "… (continued 1)");
});

Deno.test("chunkMarkdown — flat text with no double-newlines falls back to line-level split", () => {
  // Single-newline-only text mimics a scanned PDF with no paragraph breaks.
  // Total length >1500 with no \n\n triggers the line-split fallback.
  const lines = Array.from(
    { length: 50 },
    (_, i) => `Line ${i + 1}: ${"text content ".repeat(5)}`,
  );
  const doc = lines.join("\n"); // single-newline separators only
  const chunks = chunkMarkdown(doc);
  assert(chunks.length >= 2, `expected >=2 chunks from single-newline fallback, got ${chunks.length}`);
});

// ===========================================================================
// searchChunksSemanticCore
// ===========================================================================

Deno.test("searchChunksSemanticCore — returns null when embedQueryFn is undefined", async () => {
  const pool = makeMockPool([]);
  const result = await searchChunksSemanticCore(pool, undefined, { query: "test query" });
  assertEquals(result, null);
});

Deno.test("searchChunksSemanticCore — calls embedQueryFn with the query string", async () => {
  let capturedQuery: string | undefined;
  const embedSpy = async (q: string) => { capturedQuery = q; return [0.1, 0.2, 0.3]; };
  const pool = makeMockPool([{ rows: [] }]);
  await searchChunksSemanticCore(pool, embedSpy, { query: "semantic search test" });
  assertEquals(capturedQuery, "semantic search test");
});

Deno.test("searchChunksSemanticCore — returns mapped ChunkSearchResult[] with correct field types", async () => {
  const pool = makeMockPool([{
    rows: [{
      storage_key: "applications/2026-01-01-acme-swe/notes.md",
      section_title: "Fit Assessment",
      section_index: "2", // DB returns bigint as string; core must coerce to Number
      content: "Strong domain match in fintech.",
      similarity: "0.35",
    }],
  }]);
  const result = await searchChunksSemanticCore(pool, mockEmbedFn, { query: "domain fit" });
  assertEquals(result!.length, 1);
  assertEquals(result![0].storage_key, "applications/2026-01-01-acme-swe/notes.md");
  assertEquals(result![0].section_title, "Fit Assessment");
  assertEquals(result![0].section_index, 2);
  assertEquals(typeof result![0].section_index, "number");
  assertEquals(result![0].similarity, 0.35);
});

Deno.test("searchChunksSemanticCore — null section_title in DB row maps to null in result", async () => {
  const pool = makeMockPool([{
    rows: [{
      storage_key: "profiles/presales-se/presales-se-CONTENT.md",
      section_title: null,
      section_index: 0,
      content: "Preamble content of the profile document.",
      similarity: 0.42,
    }],
  }]);
  const result = await searchChunksSemanticCore(pool, mockEmbedFn, { query: "preamble" });
  assertEquals(result![0].section_title, null);
});

Deno.test("searchChunksSemanticCore — SQL uses 0.6 similarity threshold", async () => {
  const { pool, calls } = makeSpy([{ rows: [] }]);
  await searchChunksSemanticCore(pool, mockEmbedFn, { query: "threshold check" });
  assertEquals(calls.length, 1);
  assertEquals(
    calls[0].sql.includes("0.6"),
    true,
    "SQL should filter with cosine distance < 0.6",
  );
});

Deno.test("searchChunksSemanticCore — passes storage_key_prefix as SQL $2 param", async () => {
  const { pool, calls } = makeSpy([{ rows: [] }]);
  await searchChunksSemanticCore(pool, mockEmbedFn, {
    query: "interview prep",
    storage_key_prefix: "applications/2026-01-01-acme-swe/",
  });
  const params = calls[0].params as unknown[];
  assertEquals(params[1], "applications/2026-01-01-acme-swe/");
});

Deno.test("searchChunksSemanticCore — returns empty array when no rows match", async () => {
  const pool = makeMockPool([{ rows: [] }]);
  const result = await searchChunksSemanticCore(pool, mockEmbedFn, { query: "no matches" });
  assertEquals(result, []);
});
