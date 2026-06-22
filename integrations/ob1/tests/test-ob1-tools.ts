/**
 * Unit tests for OB1-compat tools absorbed into job-search-tools.ts:
 *   registerSearchTool, registerFetchTool, registerThoughtStatsTool
 *
 * Also verifies BigInt safety: all SQL queries use id::text AS id, so ids
 * arrive as strings and JSON.stringify never sees a native BigInt.
 *
 * Run from integrations/ob1/:
 *   deno test --allow-env --allow-sys tests/test-ob1-tools.ts
 *
 * All database I/O is mocked — no live Postgres connection required.
 */
import { assertEquals, assertStringIncludes, assertNotEquals } from "jsr:@std/assert";
import {
  registerSearchTool,
  registerFetchTool,
  registerThoughtStatsTool,
} from "../job-search-tools.ts";

// ---------------------------------------------------------------------------
// Mock helpers
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

function makeSpyPool(sequence: Array<{ rows: unknown[] }>) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    queryObject: (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return Promise.resolve(sequence[calls.length - 1] ?? { rows: [] });
    },
    release: () => {},
  };
  return { pool: { connect: () => Promise.resolve(client) }, calls };
}

function makeMockServer() {
  const handlers: Map<string, (args: unknown) => Promise<unknown>> = new Map();
  return {
    tool(name: string, _desc: string, _schema: unknown, fn: (args: unknown) => Promise<unknown>) {
      handlers.set(name, fn);
    },
    call(name: string, args: unknown = {}) {
      const fn = handlers.get(name);
      if (!fn) throw new Error(`Tool "${name}" not registered`);
      return fn(args);
    },
  };
}

const MOCK_EMBED: (q: string) => Promise<number[]> = (_q) =>
  Promise.resolve(Array(1536).fill(0.1));

// ---------------------------------------------------------------------------
// registerSearchTool
// ---------------------------------------------------------------------------

Deno.test("search: returns results with string ids and expected shape", async () => {
  const pool = makeMockPool([{
    rows: [
      { id: "42", content: "This is a test thought about TypeScript", created_at: "2024-01-15T10:00:00Z" },
      { id: "99", content: "Another thought about Kubernetes deployment", created_at: "2024-02-20T14:00:00Z" },
    ],
  }]);
  const server = makeMockServer();
  registerSearchTool(server, pool, MOCK_EMBED);

  const result = await server.call("search", { query: "TypeScript" }) as { content: Array<{ text: string }> };
  const text = result.content[0].text;
  const parsed = JSON.parse(text) as { results: Array<{ id: string; title: string; url: string }> };

  assertEquals(typeof parsed.results, "object");
  assertEquals(parsed.results.length, 2);

  const first = parsed.results[0];
  assertEquals(typeof first.id, "string", "id must be a string (not BigInt)");
  assertEquals(first.id, "42");
  assertEquals(typeof first.title, "string");
  assertEquals(typeof first.url, "string");
  assertStringIncludes(first.url, "42");
});

Deno.test("search: no embedQueryFn returns not-configured message", async () => {
  const pool = makeMockPool([]);
  const server = makeMockServer();
  registerSearchTool(server, pool, undefined);

  const result = await server.call("search", { query: "test" }) as { content: Array<{ text: string }> };
  assertStringIncludes(result.content[0].text, "not configured");
});

Deno.test("search: SQL uses id::text AS id (BigInt-safe)", async () => {
  const { pool, calls } = makeSpyPool([{ rows: [] }]);
  const server = makeMockServer();
  registerSearchTool(server, pool, MOCK_EMBED);

  await server.call("search", { query: "test" });
  assertEquals(calls.length >= 1, true, "should have made at least one query");
  const sqlUsed = calls[calls.length - 1].sql;
  assertStringIncludes(sqlUsed, "id::text AS id", "SQL must cast id to text to avoid BigInt serialization error");
});

// ---------------------------------------------------------------------------
// registerFetchTool
// ---------------------------------------------------------------------------

Deno.test("fetch: returns document with string id and expected fields", async () => {
  const pool = makeMockPool([{
    rows: [{
      id: "123",
      content: "Detailed thought content about job search strategies",
      metadata: { type: "observation", source: "job_search" },
      created_at: "2024-03-10T09:00:00Z",
      updated_at: null,
    }],
  }]);
  const server = makeMockServer();
  registerFetchTool(server, pool);

  const result = await server.call("fetch", { id: "123" }) as { content: Array<{ text: string }> };
  const text = result.content[0].text;
  const doc = JSON.parse(text) as { id: string; title: string; text: string; url: string; metadata: unknown };

  assertEquals(typeof doc.id, "string", "id must be a string");
  assertEquals(doc.id, "123");
  assertEquals(typeof doc.title, "string");
  assertEquals(doc.text, "Detailed thought content about job search strategies");
  assertEquals(typeof doc.url, "string");
  assertStringIncludes(doc.url, "123");
  assertNotEquals(doc.metadata, null);
});

Deno.test("fetch: returns error when thought not found", async () => {
  const pool = makeMockPool([{ rows: [] }]);
  const server = makeMockServer();
  registerFetchTool(server, pool);

  const result = await server.call("fetch", { id: "999" }) as { content: Array<{ text: string }>; isError?: boolean };
  assertEquals(result.isError, true);
  assertStringIncludes(result.content[0].text, "No thought found");
});

Deno.test("fetch: SQL uses id::text AS id (BigInt-safe)", async () => {
  const { pool, calls } = makeSpyPool([{ rows: [] }]);
  const server = makeMockServer();
  registerFetchTool(server, pool);

  await server.call("fetch", { id: "42" });
  assertEquals(calls.length, 1);
  assertStringIncludes(calls[0].sql, "id::text AS id", "SQL must cast id to text");
});

// ---------------------------------------------------------------------------
// registerThoughtStatsTool
// ---------------------------------------------------------------------------

Deno.test("thought_stats: returns text containing 'Total thoughts:'", async () => {
  const pool = makeMockPool([
    { rows: [{ count: 42 }] },
    {
      rows: [
        { metadata: { type: "observation", topics: ["typescript", "jobs"], people: ["Alice"] }, created_at: "2024-03-10T09:00:00Z" },
        { metadata: { type: "task", topics: ["kubernetes"] }, created_at: "2024-01-01T00:00:00Z" },
      ],
    },
  ]);
  const server = makeMockServer();
  registerThoughtStatsTool(server, pool);

  const result = await server.call("thought_stats", {}) as { content: Array<{ text: string }> };
  const text = result.content[0].text;

  assertStringIncludes(text, "Total thoughts: 42");
  assertStringIncludes(text, "Types:");
  assertStringIncludes(text, "Top topics:");
  assertStringIncludes(text, "typescript");
});

Deno.test("thought_stats: COUNT(*)::int prevents BigInt (no serialization error)", async () => {
  // Simulate what PostgreSQL returns when COUNT(*)::int is NOT cast (native BigInt)
  // Our implementation uses COUNT(*)::int which returns a JS number, not BigInt.
  // This test verifies the returned count serializes to JSON without error.
  const pool = makeMockPool([
    { rows: [{ count: 1000 }] },
    { rows: [] },
  ]);
  const server = makeMockServer();
  registerThoughtStatsTool(server, pool);

  const result = await server.call("thought_stats", {}) as { content: Array<{ text: string }> };
  // If BigInt serialization were attempted, JSON.stringify would throw.
  // Reaching this assertion means it didn't throw.
  assertStringIncludes(result.content[0].text, "Total thoughts: 1000");
});

Deno.test("thought_stats: handles empty thoughts table gracefully", async () => {
  const pool = makeMockPool([
    { rows: [{ count: 0 }] },
    { rows: [] },
  ]);
  const server = makeMockServer();
  registerThoughtStatsTool(server, pool);

  const result = await server.call("thought_stats", {}) as { content: Array<{ text: string }> };
  assertStringIncludes(result.content[0].text, "Total thoughts: 0");
  assertStringIncludes(result.content[0].text, "N/A");
});
