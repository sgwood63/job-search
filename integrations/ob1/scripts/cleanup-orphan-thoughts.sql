-- cleanup-orphan-thoughts.sql
-- One-time cleanup: removes thought rows of type 'file' or 'file-chunk' that are
-- no longer referenced by any js_files or js_chunks row.
--
-- These orphans accumulate when:
--   1. chunkContent re-chunks a file — old chunk thoughts were not deleted (fixed in job-search-server.ts)
--   2. upload_file replaces a file thought but the old file-chunk thoughts remain
--
-- Run against the Postgres DB directly:
--   psql $DATABASE_URL -f scripts/cleanup-orphan-thoughts.sql
--
-- Check counts before deleting:
SELECT COUNT(*) AS orphan_count
FROM thoughts t
LEFT JOIN js_files  jf ON jf.thought_id  = t.id
LEFT JOIN js_chunks jc ON jc.thought_id  = t.id
WHERE jf.thought_id IS NULL
  AND jc.thought_id IS NULL
  AND t.metadata->>'source' = 'job-search-mcp'
  AND t.metadata->>'type'   IN ('file', 'file-chunk');

-- Delete orphans (comment out the SELECT above and uncomment this block to execute):
/*
DELETE FROM thoughts
WHERE id IN (
  SELECT t.id
  FROM thoughts t
  LEFT JOIN js_files  jf ON jf.thought_id  = t.id
  LEFT JOIN js_chunks jc ON jc.thought_id  = t.id
  WHERE jf.thought_id IS NULL
    AND jc.thought_id IS NULL
    AND t.metadata->>'source' = 'job-search-mcp'
    AND t.metadata->>'type'   IN ('file', 'file-chunk')
);
*/
