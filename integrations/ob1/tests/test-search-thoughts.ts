/**
 * Unit tests for thought query MCP tools:
 *   listThoughtsCore, registerSearchThoughtsTool, registerListThoughtsTool
 *
 * Run from integrations/ob1/:
 *   deno test --allow-env --allow-sys tests/test-search-thoughts.ts
 *
 * All database I/O is mocked — no live Postgres connection required.
 */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  listThoughtsCore,
  registerSearchThoughtsTool,
  registerListThoughtsTool,
  type SearchThoughtsFn,
  type ListThoughtsFn,
} from "../job-search-tools.ts";

// ---------------------------------------------------------------------------
// Mock pool helpers (same pattern as test-knowledge-graph.ts)
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

// ---------------------------------------------------------------------------
// Minimal MCP server stub — captures registered tool handlers by name
// ---------------------------------------------------------------------------

function makeToolStub() {
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    tool(
      name: string,
      _desc: string,
      _schema: unknown,
      handler: (args: Record<string, unknown>) => Promise<unknown>,
    ) {
      handlers[name] = handler;
    },
  };
  return { server, handlers };
}

// ---------------------------------------------------------------------------
// Sample thought rows
// ---------------------------------------------------------------------------

const THOUGHT_ROW = {
  id: "42",
  content: "This is a captured thought about engineering leadership.",
  metadata: { type: "observation", topics: ["engineering", "leadership"], source: "job-search-mcp" },
  created_at: "2026-06-19T12:00:00Z",
};

const THOUGHT_ROW_2 = {
  id: "99",
  content: "Another thought about product management.",
  metadata: { type: "idea", topics: ["product"], source: "job-search-mcp" },
  created_at: "2026-06-18T09:00:00Z",
};

// ===========================================================================
// listThoughtsCore
// ===========================================================================

Deno.test("listThoughtsCore — returns rows with id, content, metadata, created_at", async () => {
  const pool = makeMockPool([{ rows: [THOUGHT_ROW] }]);
  const rows = await listThoughtsCore(pool, 10);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].id, "42");
  assertEquals(rows[0].content, THOUGHT_ROW.content);
});

Deno.test("listThoughtsCore — no filters produces no WHERE clause", async () => {
  const { pool, calls } = makeSpy([{ rows: [] }]);
  await listThoughtsCore(pool, 5);
  assertEquals(calls.length, 1);
  const sql = calls[0].sql;
  assertEquals(sql.includes("WHERE"), false);
  assertEquals(sql.includes("LIMIT"), true);
  // limit is the first (and only) param
  assertEquals(calls[0].params, [5]);
});

Deno.test("listThoughtsCore — type filter adds WHERE clause with correct param", async () => {
  const { pool, calls } = makeSpy([{ rows: [] }]);
  await listThoughtsCore(pool, 10, "observation");
  assertEquals(calls.length, 1);
  assertStringIncludes(calls[0].sql, "metadata->>'type'");
  assertEquals((calls[0].params as unknown[])[0], "observation");
  // limit is the last param
  assertEquals((calls[0].params as unknown[]).at(-1), 10);
});

Deno.test("listThoughtsCore — topic filter adds JSONB array-contains clause", async () => {
  const { pool, calls } = makeSpy([{ rows: [] }]);
  await listThoughtsCore(pool, 10, undefined, "engineering");
  assertStringIncludes(calls[0].sql, "metadata->'topics'");
  assertEquals((calls[0].params as unknown[])[0], "engineering");
});

Deno.test("listThoughtsCore — person filter adds JSONB array-contains clause", async () => {
  const { pool, calls } = makeSpy([{ rows: [] }]);
  await listThoughtsCore(pool, 10, undefined, undefined, "Alice");
  assertStringIncludes(calls[0].sql, "metadata->'people'");
  assertEquals((calls[0].params as unknown[])[0], "Alice");
});

Deno.test("listThoughtsCore — days filter adds date comparison (no SQL injection)", async () => {
  const { pool, calls } = makeSpy([{ rows: [] }]);
  await listThoughtsCore(pool, 10, undefined, undefined, undefined, 7);
  assertStringIncludes(calls[0].sql, "INTERVAL '7 days'");
  // days value is interpolated as Number(), not as a user param
});

Deno.test("listThoughtsCore — multiple filters combined with AND", async () => {
  const { pool, calls } = makeSpy([{ rows: [] }]);
  await listThoughtsCore(pool, 5, "idea", "product");
  assertStringIncludes(calls[0].sql, "AND");
  assertStringIncludes(calls[0].sql, "metadata->>'type'");
  assertStringIncludes(calls[0].sql, "metadata->'topics'");
});

// ===========================================================================
// registerSearchThoughtsTool handler
// ===========================================================================

function makeSearchThoughtsFn(rows: Array<{ id: string; content: string; metadata: Record<string, unknown>; similarity: number; created_at: string }>): SearchThoughtsFn {
  return async (_query, _limit, _filter) => rows;
}

Deno.test("registerSearchThoughtsTool — output includes ID line and result header", async () => {
  const { server, handlers } = makeToolStub();
  registerSearchThoughtsTool(server, makeSearchThoughtsFn([{ ...THOUGHT_ROW, similarity: 0.87 }]));

  const result = await handlers["search_thoughts"]({ query: "engineering" }) as { content: Array<{ text: string }> };
  const text = result.content[0].text;

  assertStringIncludes(text, "--- Result 1 (87.0% match) ---");
  assertStringIncludes(text, "ID: 42");
  assertStringIncludes(text, "Captured:");
  assertStringIncludes(text, "Type: observation");
  assertStringIncludes(text, "Topics: engineering, leadership");
  assertStringIncludes(text, THOUGHT_ROW.content);
});

Deno.test("registerSearchThoughtsTool — empty results returns not-found message", async () => {
  const { server, handlers } = makeToolStub();
  registerSearchThoughtsTool(server, makeSearchThoughtsFn([]));

  const result = await handlers["search_thoughts"]({ query: "xyz" }) as { content: Array<{ text: string }> };
  assertStringIncludes(result.content[0].text, "No thoughts found");
});

Deno.test("registerSearchThoughtsTool — type_filter applied post-query", async () => {
  const { server, handlers } = makeToolStub();
  const rows = [
    { ...THOUGHT_ROW, similarity: 0.9 },              // type: observation
    { ...THOUGHT_ROW_2, similarity: 0.8 },            // type: idea
  ];
  registerSearchThoughtsTool(server, makeSearchThoughtsFn(rows));

  const result = await handlers["search_thoughts"]({ query: "anything", type_filter: "observation" }) as { content: Array<{ text: string }> };
  const text = result.content[0].text;
  assertStringIncludes(text, "Found 1 thought(s)");
  assertStringIncludes(text, "ID: 42");
  assertEquals(text.includes("ID: 99"), false);
});

Deno.test("registerSearchThoughtsTool — missing callback returns error message", async () => {
  const { server, handlers } = makeToolStub();
  registerSearchThoughtsTool(server, undefined);

  const result = await handlers["search_thoughts"]({ query: "test" }) as { content: Array<{ text: string }> };
  assertStringIncludes(result.content[0].text, "not configured");
});

// ===========================================================================
// registerListThoughtsTool handler
// ===========================================================================

function makeListThoughtsFn(rows: Array<{ id: string; content: string; metadata: Record<string, unknown>; created_at: string }>): ListThoughtsFn {
  return async (_limit, _type, _topic, _person, _days) => rows;
}

Deno.test("registerListThoughtsTool — output includes [id:N] in each entry", async () => {
  const { server, handlers } = makeToolStub();
  registerListThoughtsTool(server, makeListThoughtsFn([THOUGHT_ROW, THOUGHT_ROW_2]));

  const result = await handlers["list_thoughts"]({ limit: 10 }) as { content: Array<{ text: string }> };
  const text = result.content[0].text;

  assertStringIncludes(text, "[id:42]");
  assertStringIncludes(text, "[id:99]");
  assertStringIncludes(text, "2 recent thought(s)");
  assertStringIncludes(text, "observation");
  assertStringIncludes(text, "engineering, leadership");
});

Deno.test("registerListThoughtsTool — empty results returns not-found message", async () => {
  const { server, handlers } = makeToolStub();
  registerListThoughtsTool(server, makeListThoughtsFn([]));

  const result = await handlers["list_thoughts"]({ limit: 5 }) as { content: Array<{ text: string }> };
  assertStringIncludes(result.content[0].text, "No thoughts found");
});

Deno.test("registerListThoughtsTool — missing callback returns error message", async () => {
  const { server, handlers } = makeToolStub();
  registerListThoughtsTool(server, undefined);

  const result = await handlers["list_thoughts"]({}) as { content: Array<{ text: string }> };
  assertStringIncludes(result.content[0].text, "not configured");
});

Deno.test("registerListThoughtsTool — entry format matches expected pattern", async () => {
  const { server, handlers } = makeToolStub();
  registerListThoughtsTool(server, makeListThoughtsFn([THOUGHT_ROW]));

  const result = await handlers["list_thoughts"]({}) as { content: Array<{ text: string }> };
  const text = result.content[0].text;

  // Pattern: "1. [date] (type - tags) [id:ID]\n   content"
  assertStringIncludes(text, "(observation - engineering, leadership) [id:42]");
  assertStringIncludes(text, THOUGHT_ROW.content);
});
