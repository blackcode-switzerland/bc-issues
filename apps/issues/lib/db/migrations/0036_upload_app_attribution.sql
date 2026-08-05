-- Phase 7: storage & blob attribution — `platform.uploads` learns which app
-- wrote each file.
--
-- ADDITIVE, ENTIRELY. One nullable ADD COLUMN, one foreign key, one index, and a
-- backfill. Nothing is dropped, renamed or tightened, which is what lets this be
-- applied BEFORE the deploy that uses it (the cutover pattern in
-- PLATFORM-MIGRATION-PLAN.md) with no window in which the running code is wrong.
--
-- WHY `app` IS NULLABLE. Same reason as `events.app` in 0035: for the length of
-- the window between this migration and the promote, the OLD code is still
-- inserting upload rows and does not know the column exists. NOT NULL would fail
-- every upload made in that window — including the client-direct Blob flow,
-- where the bytes are already stored by the time the ledger row is written, so a
-- failed insert would leave a file nothing can account for. A DEFAULT 'issues'
-- would hardcode one app's name into a platform table, which is the coupling
-- this migration exists to remove. So: nullable, backfilled below, written by
-- all current code, and tightened to NOT NULL in Phase 8 once no deployed code
-- can write a NULL. That is expand → migrate → contract
-- (PLATFORM-ARCHITECTURE.md §4.7).
--
-- ON DELETE set null, not cascade. Deregistering an app must not delete the
-- ledger rows for files that still exist in the store: an unattributed row is
-- recoverable, a missing one hides bytes nobody can find again.
--
-- EXISTING BLOBS ARE NOT MOVED. From this release new uploads are written under
-- `<app>/<workspace>/<file>`, but everything already in the store stays exactly
-- where it is and `pathname` keeps recording where that is. A path is a
-- historical fact; attribution comes from this column, never from the prefix.
--
-- THE BACKFILL IS IN THIS FILE ON PURPOSE. `issues` is the only app that has
-- ever run, so every existing row is one of its files. Left NULL they would
-- vanish from `bk storage list --app issues` while still occupying space — a
-- filter that silently hides files is worse than no filter. DDL and backfill
-- must never be applied apart.
--
-- Re-runnable: the UPDATE is guarded by IS NULL. Rollback is
-- docs/sql/phase7-rollback.sql.

ALTER TABLE "platform"."uploads" ADD COLUMN "app" varchar(40);--> statement-breakpoint
ALTER TABLE "platform"."uploads" ADD CONSTRAINT "uploads_app_apps_slug_fk" FOREIGN KEY ("app") REFERENCES "platform"."apps"("slug") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_uploads_workspace_app" ON "platform"."uploads" USING btree ("workspace_id","app");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- BACKFILL
-- ---------------------------------------------------------------------------
UPDATE "platform"."uploads" SET app = 'issues' WHERE app IS NULL;
