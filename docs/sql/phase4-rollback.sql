-- Phase 4 rollback.
--
-- READ THIS FIRST: you almost certainly do not want this file.
--
-- Phase 4's risk is *enforcement*, not the schema. The three new tables are
-- inert — nothing reads them unless the code decides to — so the first and only
-- rollback anyone should reach for is the kill switch:
--
--     vercel env add PLATFORM_ENFORCE_APP_ACCESS production   # value: 0
--     …then redeploy, or promote the previous deployment.
--
-- That restores exactly the pre-Phase-4 behaviour (membership alone decides
-- access) in one variable, with no DDL and no data loss. The tables can stay.
--
-- This script exists for the other case: rolling the *schema* back, e.g. to
-- re-apply a corrected migration. It drops the three tables and their data —
-- every grant an admin has made since the deploy is lost, and re-applying 0034
-- rebuilds only what the backfill can derive (one row per member, role mirrored,
-- default_access = 'all_members'). Any `invite_only` decision or hand-revoked
-- grant will silently come back. That is why this is the second choice.
--
-- Run as the schema owner (neondb_owner).
--
-- REHEARSED: 2026-08-04 on Neon branch `phase4-rehearsal`, immediately after
-- applying 0034 there. Verified to leave workspace_members and every other table
-- untouched, and to let `drizzle-kit migrate` re-apply 0034 cleanly afterwards.

BEGIN;

-- 1. The invitation column. Dropping it discards any per-app invite targeting;
--    pending org-level invitations (app IS NULL) are unaffected.
ALTER TABLE "platform"."workspace_invitations"
  DROP CONSTRAINT IF EXISTS "workspace_invitations_app_apps_slug_fk";
ALTER TABLE "platform"."workspace_invitations" DROP COLUMN IF EXISTS "app";

-- 2. The three tables. Order matters: app_access and workspace_apps both FK to
--    apps. RESTRICT (the default) would refuse while those FKs exist, so drop the
--    dependents first and never reach for CASCADE on `apps`.
DROP TABLE IF EXISTS "platform"."app_access";
DROP TABLE IF EXISTS "platform"."workspace_apps";
DROP TABLE IF EXISTS "platform"."apps";

-- 3. Rewind the Drizzle ledger past 0034 so a later `migrate` re-applies it
--    rather than believing it is already done.
DELETE FROM "drizzle"."__drizzle_migrations"
 WHERE "hash" IN (
   SELECT "hash" FROM "drizzle"."__drizzle_migrations" ORDER BY "created_at" DESC LIMIT 1
 );

COMMIT;

-- 4. Verify: all three must return zero rows.
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'platform' AND table_name IN ('apps','workspace_apps','app_access');
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'platform' AND table_name = 'workspace_invitations' AND column_name = 'app';
--   -- and membership must be intact (this returns the pre-rollback count, not zero):
--   SELECT count(*) FROM platform.workspace_members;
