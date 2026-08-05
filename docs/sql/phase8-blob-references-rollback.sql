-- Phase 8 rollback — the cross-deployment blob reference index (0037).
--
-- READ THIS FIRST: you almost certainly do not need it, and running it has a
-- cost the other rollbacks do not.
--
-- 0037 is additive and inert to the pre-Phase-8 code: a new table, a new column
-- with a default, three functions and six triggers. The old code neither reads
-- nor writes any of it, and the triggers maintain the index for the old code
-- just as happily as for the new. So the first rollback is **promote the
-- previous deployment**. The index keeps being maintained, `maintains_blob_index`
-- keeps being true, and the delete gate reverts to Phase 7's behaviour (every
-- enabled app must have a registered scanner) — which is correct as long as
-- `platform.apps` holds exactly one row, which it must until a second app ships.
--
-- ---------------------------------------------------------------------------
-- WHAT RUNNING THIS COSTS, AND WHY THE ORDER BELOW MATTERS
-- ---------------------------------------------------------------------------
-- Dropping the index is only safe while `issues` is the only app. The moment a
-- second app exists, the index is the ONLY way this deployment can learn what
-- that app references — its Postgres role cannot read the other schema. Dropping
-- it then does not restore Phase 7 behaviour; it restores Phase 7's *bug*, where
-- blob deletion refuses everything.
--
-- So step 1 is to clear `maintains_blob_index` BEFORE dropping anything. That
-- flag is what tells another deployment "you may skip asking me". Dropping the
-- table while the flag is still true would leave other apps reading an index
-- that no longer exists — and an empty answer from a missing index reads as
-- "nothing references this file", which is how the bytes get deleted.
--
-- Check what you are about to lose first:
--
--     SELECT app, source_type, count(*) FROM platform.blob_references
--     GROUP BY 1, 2 ORDER BY 1, 2;
--     SELECT slug, maintains_blob_index FROM platform.apps;
--
-- Run as the schema owner (neondb_owner); the app role has no DDL and holds only
-- SELECT on the table.
--
-- REBUILDING is cheap and needs no backup of this table: re-apply 0037. Its
-- backfill re-derives every row from the source tables by re-triggering them, so
-- nothing here is data you cannot get back — which is the whole point of a
-- projection.

-- WHAT THIS DELIBERATELY DOES NOT UNDO: 0037 also backfills
-- `issues.attachments.workspace_id`, which had been NULL on every row since the
-- column was added. That is a data REPAIR, not part of the index, and it is
-- correct with or without this feature — re-NULLing it would only restore a bug.
--
-- Rehearsed forward → back → forward on Neon branch phase8-clean-rehearsal-2 on
-- 2026-08-05: 38 → 37 → 38 migrations, storage suite green at each end.

-- 1. Stop advertising coverage FIRST. See above.
UPDATE platform.apps SET maintains_blob_index = false;

-- 2. The triggers. Nothing writes the index after this.
DROP TRIGGER IF EXISTS trg_blob_refs ON issues.issues;
DROP TRIGGER IF EXISTS trg_blob_refs ON issues.tasks;
DROP TRIGGER IF EXISTS trg_blob_refs ON issues.projects;
DROP TRIGGER IF EXISTS trg_blob_refs ON issues.project_updates;
DROP TRIGGER IF EXISTS trg_blob_refs ON issues.attachments;
DROP TRIGGER IF EXISTS trg_blob_refs ON platform.comments;

-- 3. The functions.
DROP FUNCTION IF EXISTS platform.blob_refs_sync();
DROP FUNCTION IF EXISTS platform.blob_refs_purge(text, text, bigint);
DROP FUNCTION IF EXISTS platform.extract_uploaded_urls(text);
DROP FUNCTION IF EXISTS platform.is_uploaded_asset(text);
DROP FUNCTION IF EXISTS platform.blob_url_host(text);

-- 4. The table and the column.
DROP TABLE IF EXISTS platform.blob_references;
ALTER TABLE platform.apps DROP COLUMN IF EXISTS maintains_blob_index;

-- 5. The Drizzle ledger, so a re-apply is possible. Match by hash rather than by
--    position: `created_at` is the journal timestamp (when the file was
--    generated), not when it was applied, so ordering by it is not reliable.
--    Check the row before deleting it.
--
--   SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 3;
--   DELETE FROM drizzle.__drizzle_migrations WHERE id = <the 0037 row>;
