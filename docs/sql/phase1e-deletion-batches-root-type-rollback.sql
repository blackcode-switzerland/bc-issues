-- Phase 1e-2 rollback — `platform.deletion_batches.root_type` back to bare (0042).
--
-- The mirror of `phase1e-comments-parent-type-rollback.sql`; read that file's
-- header for the decision tree, it applies unchanged. The only difference in
-- severity is what a stale build does with un-rolled-back data: `root_type` is
-- never filtered on, only compared client-side against an item's own `type`
-- (`components/trash-view.tsx`), so an old build shows the recycle bin with
-- batch grouping wrong rather than with rows missing. Annoying, not alarming.
--
-- `root_type` is NOT NULL, so there is no null branch to worry about.
--
-- Check who else has written here before considering STEP 2:
--
--     SELECT split_part(root_type, ':', 1) AS app, count(*)
--     FROM platform.deletion_batches WHERE root_type LIKE '%:%'
--     GROUP BY 1 ORDER BY 1;
--
-- Run as the schema owner (neondb_owner).

-- ---------------------------------------------------------------------------
-- STEP 1 — un-qualify this app's rows. Idempotent; safe to re-run.
-- ---------------------------------------------------------------------------
UPDATE platform.deletion_batches
   SET root_type = substr(root_type, length('issues:') + 1)
 WHERE root_type IN ('issues:issue', 'issues:task', 'issues:project');

-- ---------------------------------------------------------------------------
-- STEP 2 — restore the pre-0042 constraint and width. OPTIONAL. Read the header.
-- ---------------------------------------------------------------------------
-- ALTER TABLE platform.deletion_batches DROP CONSTRAINT deletion_batches_root_type_check;
-- ALTER TABLE platform.deletion_batches ALTER COLUMN root_type TYPE varchar(20);
-- ALTER TABLE platform.deletion_batches ADD CONSTRAINT deletion_batches_root_type_check
--   CHECK (root_type IN ('project', 'task', 'issue'));

-- Verify (expect: zero qualified rows left for this app).
SELECT root_type, count(*) FROM platform.deletion_batches GROUP BY 1 ORDER BY 1;
