-- Phase 3 rollback — data-preserving, in place.
--
-- This is the rollback you actually want. Resetting the branch from the
-- `pre-platform-migration` snapshot also works, but it discards every row
-- written since the snapshot was taken — acceptable as disaster recovery, not
-- as a rollback for a product in daily use.
--
-- Run as the schema owner (neondb_owner), then redeploy the previous release
-- and restore the previous DATABASE_URL.
--
-- REHEARSED: 2026-08-04 on Neon branch `phase3-rehearsal`. Verified to return
-- 26 tables to `public`, restore comments.issue_id with its FK, and leave every
-- row count unchanged.

BEGIN;

-- 1. Move the app tables back to public (10).
ALTER TABLE "issues"."issues"           SET SCHEMA "public";
ALTER TABLE "issues"."tasks"            SET SCHEMA "public";
ALTER TABLE "issues"."projects"         SET SCHEMA "public";
ALTER TABLE "issues"."project_updates"  SET SCHEMA "public";
ALTER TABLE "issues"."issue_labels"     SET SCHEMA "public";
ALTER TABLE "issues"."issue_assignees"  SET SCHEMA "public";
ALTER TABLE "issues"."issue_watchers"   SET SCHEMA "public";
ALTER TABLE "issues"."project_labels"   SET SCHEMA "public";
ALTER TABLE "issues"."project_members"  SET SCHEMA "public";
ALTER TABLE "issues"."attachments"      SET SCHEMA "public";

-- 2. Move the platform tables back to public (16).
ALTER TABLE "platform"."users"                  SET SCHEMA "public";
ALTER TABLE "platform"."workspaces"             SET SCHEMA "public";
ALTER TABLE "platform"."workspace_members"      SET SCHEMA "public";
ALTER TABLE "platform"."workspace_counters"     SET SCHEMA "public";
ALTER TABLE "platform"."workspace_invitations"  SET SCHEMA "public";
ALTER TABLE "platform"."api_tokens"             SET SCHEMA "public";
ALTER TABLE "platform"."password_reset_otps"    SET SCHEMA "public";
ALTER TABLE "platform"."email_whitelist"        SET SCHEMA "public";
ALTER TABLE "platform"."uploads"                SET SCHEMA "public";
ALTER TABLE "platform"."comments"               SET SCHEMA "public";
ALTER TABLE "platform"."labels"                 SET SCHEMA "public";
ALTER TABLE "platform"."events"                 SET SCHEMA "public";
ALTER TABLE "platform"."inbox_messages"         SET SCHEMA "public";
ALTER TABLE "platform"."transaction_log"        SET SCHEMA "public";
ALTER TABLE "platform"."deletion_batches"       SET SCHEMA "public";
ALTER TABLE "platform"."error_events"           SET SCHEMA "public";

-- 3. Restore comments.issue_id, backfilled from the polymorphic pointer.
--    Safe because the two were mirrored exactly: at the time of the drop, 0 rows
--    had parent_type='issue' with issue_id disagreeing with parent_id.
ALTER TABLE "public"."comments" ADD COLUMN "issue_id" integer;
UPDATE "public"."comments"
   SET "issue_id" = "parent_id"
 WHERE "parent_type" = 'issue';
ALTER TABLE "public"."comments"
  ADD CONSTRAINT "comments_issue_id_issues_id_fk"
  FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade;
CREATE INDEX "idx_comments_issue" ON "public"."comments" ("issue_id");

-- 4. Rewind the Drizzle ledger past 0032 and 0033 so a later `migrate` re-applies
--    them rather than believing they are already done.
DELETE FROM "drizzle"."__drizzle_migrations"
 WHERE "hash" IN (
   SELECT "hash" FROM "drizzle"."__drizzle_migrations" ORDER BY "created_at" DESC LIMIT 2
 );

-- 5. Drop the now-empty schemas. RESTRICT (the default) refuses if anything is
--    left behind, which is the check we want — never force this with CASCADE.
DROP SCHEMA "issues"   RESTRICT;
DROP SCHEMA "platform" RESTRICT;

COMMIT;

-- 6. Outside the transaction: retire the app role. Keep it if you intend to roll
--    forward again shortly.
-- DROP ROLE issues_app;
