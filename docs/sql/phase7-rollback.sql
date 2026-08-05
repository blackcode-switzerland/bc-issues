-- Phase 7 rollback — upload app attribution.
--
-- READ THIS FIRST: you almost certainly do not need it.
--
-- 0036 is additive and inert to the pre-Phase-7 code: `platform.uploads.app` is
-- a nullable column the old code never mentions. So the first rollback is
-- **promote the previous deployment**. New uploads go back to being written at
-- the store root and the ledger stops being stamped with an app; nothing breaks,
-- and nothing that was already stored moves. Re-deploying forward and re-running
-- the backfill line at the bottom of 0036 repairs the gap.
--
-- The one thing rolling the CODE back does NOT undo: files uploaded while the
-- new code was live are stored at `issues/<workspace>/<file>` and stay there.
-- That is deliberate and harmless — every url is absolute and `pathname` records
-- the real location, so the old code serves and deletes them exactly as well as
-- the new code does. Never "fix" it by moving blobs.
--
-- This script is for the other case: rolling the *schema* back to re-apply a
-- corrected migration.
--
-- WHAT IS LOST. `app` is derived-ish: today every row is 'issues' and the
-- backfill reconstructs it exactly. Once a second app has uploaded a file, this
-- rollback loses attribution the backfill CANNOT reconstruct — the pathname
-- prefix is the only remaining clue, and pre-Phase-7 files have none. Check
-- before running it:
--
--     SELECT app, count(*) FROM platform.uploads GROUP BY app;
--
-- Run as the schema owner (neondb_owner); the app role has no DDL.
--
-- REHEARSED: see the Phase 7 report. Rehearsed on the Neon branch listed there,
-- immediately after applying 0036, and verified that `drizzle-kit migrate`
-- re-applies 0036 cleanly afterwards.

BEGIN;

-- 1. The column, its foreign key and its index.
ALTER TABLE "platform"."uploads" DROP CONSTRAINT IF EXISTS "uploads_app_apps_slug_fk";
DROP INDEX IF EXISTS "platform"."idx_uploads_workspace_app";
ALTER TABLE "platform"."uploads" DROP COLUMN IF EXISTS "app";

-- 2. Rewind the Drizzle ledger past 0036 so a later `migrate` re-applies it
--    rather than believing it is already done.
DELETE FROM "drizzle"."__drizzle_migrations"
 WHERE "hash" IN (
   SELECT "hash" FROM "drizzle"."__drizzle_migrations" ORDER BY "created_at" DESC LIMIT 1
 );

COMMIT;

-- 3. Verify: the first must return zero rows, the second must return the
--    unchanged pre-rollback count (the ledger is a record of real files and must
--    not be touched).
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'platform' AND table_name = 'uploads' AND column_name = 'app';
--   SELECT count(*) FROM platform.uploads;
