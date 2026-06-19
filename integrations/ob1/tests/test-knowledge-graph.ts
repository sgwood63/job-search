/**
 * Unit tests for Phase 3 knowledge graph MCP tool core functions:
 *   createKnowledgeEdgeCore, getEntityNeighborsCore, traverseKnowledgeGraphCore
 *
 * Run from integrations/ob1/:
 *   deno test --allow-env --allow-sys tests/test-knowledge-graph.ts
 *
 * All database I/O is mocked — no live Postgres connection required.
 */
import { assertEquals } from "jsr:@std/assert";
import {
  createKnowledgeEdgeCore,
  getEntityNeighborsCore,
  traverseKnowledgeGraphCore,
} from "../job-search-tools.ts";

// ---------------------------------------------------------------------------
// Mock pool helpers
// ---------------------------------------------------------------------------

/**
 * makeMockPool — returns a pool whose single client answers queryObject calls
 * from a sequential list of responses.  The same client object is returned
 * from every connect() call, so the counter is shared across all calls within
 * a single test.
 */
function makeMockPool(sequence: Array<{ rows: unknown[] }>) {
  let i = 0;
  const client = {
    queryObject: (_sql: string, _params?: unknown[]) =>
      Promise.resolve(sequence[i++] ?? { rows: [] }),
    release: () => {},
  };
  return { connect: () => Promise.resolve(client) };
}

/**
 * makeSpy — like makeMockPool but also captures (sql, params) for each call
 * so tests can assert on the generated SQL and parameter values.
 */
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

// ===========================================================================
// createKnowledgeEdgeCore
// ===========================================================================

Deno.test("createKnowledgeEdgeCore — creates edge, returns action=created", async () => {
  // Sequence: upsertEntity(from) → upsertEntity(to) → INSERT edge
  const pool = makeMockPool([
    { rows: [{ id: 1 }] },
    { rows: [{ id: 2 }] },
    { rows: [{ id: 10, support_count: 1 }] },
  ]);
  const result = await createKnowledgeEdgeCore(pool, {
    from_entity_type: "organization",
    from_entity_name: "Acme Corp",
    relation: "requires",
    to_entity_type: "tool",
    to_entity_name: "Python",
  });
  assertEquals(result.from_entity_id, 1);
  assertEquals(result.to_entity_id, 2);
  assertEquals(result.edge_id, 10);
  assertEquals(result.support_count, 1);
  assertEquals(result.action, "created");
});

Deno.test("createKnowledgeEdgeCore — returns action=incremented when support_count > 1", async () => {
  // Simulates a second call on the same edge triple — support_count bumped to 2
  const pool = makeMockPool([
    { rows: [{ id: 1 }] },
    { rows: [{ id: 2 }] },
    { rows: [{ id: 10, support_count: 2 }] },
  ]);
  const result = await createKnowledgeEdgeCore(pool, {
    from_entity_type: "organization",
    from_entity_name: "Acme Corp",
    relation: "requires",
    to_entity_type: "tool",
    to_entity_name: "Python",
  });
  assertEquals(result.action, "incremented");
  assertEquals(result.support_count, 2);
});

Deno.test("createKnowledgeEdgeCore — inserts into thought_entities when thought_id provided", async () => {
  const { pool, calls } = makeSpy([
    { rows: [{ id: 1 }] },
    { rows: [{ id: 2 }] },
    { rows: [{ id: 10, support_count: 1 }] },
    { rows: [] }, // thought_entities INSERT
  ]);
  await createKnowledgeEdgeCore(pool, {
    from_entity_type: "person",
    from_entity_name: "Alice Smith",
    relation: "member_of",
    to_entity_type: "organization",
    to_entity_name: "Acme Corp",
    thought_id: "42",
  });
  assertEquals(calls.length, 4, "expected 4 queryObject calls with thought_id");
  assertEquals(
    calls[3].sql.includes("thought_entities"),
    true,
    "4th call should INSERT into thought_entities",
  );
});

Deno.test("createKnowledgeEdgeCore — skips thought_entities when no thought_id", async () => {
  const { pool, calls } = makeSpy([
    { rows: [{ id: 3 }] },
    { rows: [{ id: 4 }] },
    { rows: [{ id: 11, support_count: 1 }] },
  ]);
  await createKnowledgeEdgeCore(pool, {
    from_entity_type: "project",
    from_entity_name: "AI Dashboard",
    relation: "demonstrates",
    to_entity_type: "topic",
    to_entity_name: "Data Visualization",
  });
  assertEquals(calls.length, 3, "expected only 3 queryObject calls without thought_id");
});

// ===========================================================================
// getEntityNeighborsCore
// ===========================================================================

Deno.test("getEntityNeighborsCore — returns mapped neighbors in out direction", async () => {
  const pool = makeMockPool([
    { rows: [{ id: 7 }] }, // entity lookup
    {
      rows: [
        {
          entity_id: 10,
          entity_type: "tool",
          entity_name: "Python",
          relation: "requires",
          support_count: 5,
          metadata: {},
        },
        {
          entity_id: 11,
          entity_type: "tool",
          entity_name: "SQL",
          relation: "requires",
          support_count: 2,
          metadata: null,
        },
      ],
    },
  ]);
  const result = await getEntityNeighborsCore(pool, {
    entity_name: "Acme Corp",
    entity_type: "organization",
    relation: "requires",
    direction: "out",
  });
  assertEquals(result.length, 2);
  assertEquals(result[0].entity_name, "Python");
  assertEquals(result[0].entity_type, "tool");
  assertEquals(result[0].support_count, 5);
  assertEquals(result[1].entity_name, "SQL");
  // metadata=null should be coerced to {}
  assertEquals(typeof result[1].metadata, "object");
});

Deno.test("getEntityNeighborsCore — returns empty array when entity not found", async () => {
  const pool = makeMockPool([
    { rows: [] }, // entity lookup — nothing found
  ]);
  const result = await getEntityNeighborsCore(pool, {
    entity_name: "Nonexistent Company",
  });
  assertEquals(result, []);
});

Deno.test("getEntityNeighborsCore — includes relation in SQL params when relation filter given", async () => {
  const { pool, calls } = makeSpy([
    { rows: [{ id: 3 }] },
    { rows: [] },
  ]);
  await getEntityNeighborsCore(pool, {
    entity_name: "Acme Corp",
    relation: "requires",
  });
  // The neighbor query (calls[1]) should pass the relation value as a parameter
  const neighborParams = calls[1].params as unknown[];
  assertEquals(
    neighborParams.includes("requires"),
    true,
    "neighbor query params should contain the relation string",
  );
});

Deno.test("getEntityNeighborsCore — uses to_entity_id as filter column for direction=in", async () => {
  const { pool, calls } = makeSpy([
    { rows: [{ id: 4 }] },
    { rows: [] },
  ]);
  await getEntityNeighborsCore(pool, {
    entity_name: "Python",
    entity_type: "tool",
    direction: "in",
  });
  // For direction=in, the neighbor query filters by to_entity_id (not from_entity_id)
  assertEquals(
    calls[1].sql.includes("to_entity_id"),
    true,
    "direction=in should filter on to_entity_id",
  );
});

// ===========================================================================
// traverseKnowledgeGraphCore
// ===========================================================================

// traverseKnowledgeGraphCore internally calls getEntityNeighborsCore(pool, {limit:1})
// then opens its own client for BFS.  The shared counter covers all calls:
//   [0] getEntityNeighborsCore entity lookup
//   [1] getEntityNeighborsCore neighbors (limit=1, result unused by traversal)
//   [2] traversal: start-entity lookup
//   [3+] traversal: hop queries per depth level

Deno.test("traverseKnowledgeGraphCore — returns start node and one-hop neighbors", async () => {
  const pool = makeMockPool([
    { rows: [{ id: 99 }] },  // getEntityNeighborsCore entity lookup
    { rows: [] },             // getEntityNeighborsCore neighbors (unused)
    // traversal entity lookup
    { rows: [{ id: 5, entity_type: "organization", canonical_name: "Acme Corp" }] },
    // hop 1
    {
      rows: [{
        src_id: 5,
        nb_id: 6,
        relation: "requires",
        support_count: 3,
        entity_type: "tool",
        canonical_name: "Python",
      }],
    },
  ]);
  const result = await traverseKnowledgeGraphCore(pool, {
    start_entity_name: "Acme Corp",
    max_depth: 1,
  });
  assertEquals(result.nodes.length, 2);
  assertEquals(result.nodes[0].entity_name, "Acme Corp");
  assertEquals(result.nodes[0].entity_type, "organization");
  assertEquals(result.nodes[1].entity_name, "Python");
  assertEquals(result.edges.length, 1);
  assertEquals(result.edges[0].relation, "requires");
  assertEquals(result.edges[0].support_count, 3);
  assertEquals(result.edges[0].from_id, 5);
  assertEquals(result.edges[0].to_id, 6);
});

Deno.test("traverseKnowledgeGraphCore — returns empty result when start entity not found", async () => {
  // getEntityNeighborsCore: entity not found → returns [] (1 call only)
  // traversal: start-entity lookup also returns nothing → {nodes:[],edges:[]}
  const pool = makeMockPool([
    { rows: [] }, // getEntityNeighborsCore entity lookup — not found
    { rows: [] }, // traversal entity lookup — not found
  ]);
  const result = await traverseKnowledgeGraphCore(pool, {
    start_entity_name: "Nonexistent Corp",
  });
  assertEquals(result.nodes, []);
  assertEquals(result.edges, []);
});

Deno.test("traverseKnowledgeGraphCore — hop query includes ANY() clause when relation_types given", async () => {
  const { pool, calls } = makeSpy([
    { rows: [{ id: 99 }] }, // getEntityNeighborsCore entity lookup
    { rows: [] },            // getEntityNeighborsCore neighbors
    { rows: [{ id: 5, entity_type: "organization", canonical_name: "Acme Corp" }] },
    { rows: [] },            // hop 1 — no results (frontier exhausted)
  ]);
  await traverseKnowledgeGraphCore(pool, {
    start_entity_name: "Acme Corp",
    relation_types: ["requires"],
  });
  // calls[3] is the BFS hop query — must use ANY() for the relation filter
  const hopSql = calls[3]?.sql ?? "";
  assertEquals(
    hopSql.includes("ANY"),
    true,
    "hop query should use ANY($::text[]) for relation_types filter",
  );
});
