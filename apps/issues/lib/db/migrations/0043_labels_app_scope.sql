-- Phase 1e-3 (D-14): `platform.labels.app` — labels become app-scopable.
--
-- ---------------------------------------------------------------------------
-- WHAT NULL MEANS, AND WHY EVERY EXISTING ROW KEEPS IT
-- ---------------------------------------------------------------------------
--   NULL  — shared: visible to every app in the workspace.
--   set   — scoped: visible only to that app.
--
-- This column is added NULLABLE AND NOT BACKFILLED. That is the whole of the
-- expand step here: every row that exists today keeps the meaning it has today,
-- so no deployed build's label list changes when this lands.
--
-- CONSEQUENCE, STATED BECAUSE IT IS EASY TO MISS: the issues workspace's
-- existing labels are shared, so they WILL appear in the second app's picker.
-- Whether they should is a product question with a one-line answer either way
-- (`UPDATE platform.labels SET app = 'issues' WHERE app IS NULL`), and it does
-- not have to be answered before this migration — only before the second app
-- launches. It is recorded in docs/next-fixes.md under OPEN FOLLOW-UPS.
--
-- ---------------------------------------------------------------------------
-- THE FK, AND WHY SET NULL
-- ---------------------------------------------------------------------------
-- Same shape as `platform.uploads.app`, `platform.events.app` and
-- `platform.workspace_invitations.app`: a reference to `platform.apps(slug)`
-- with ON DELETE SET NULL. Deregistering an app must not delete labels that are
-- still attached to live rows in another app's tables — `issues.issue_labels`
-- and `issues.project_labels` both FK into this table with ON DELETE CASCADE, so
-- a cascade here would silently strip labels off issues.
--
-- SET NULL does widen visibility (a deregistered app's labels become shared).
-- That is the least-bad of the three: cascade destroys data, RESTRICT makes
-- `bk super-admin` unable to deregister an app that ever created a label, and
-- SET NULL leaves rows that are visible and fixable.
--
-- ---------------------------------------------------------------------------
-- FILTERING IS NOT OPTIONAL AND IS NOT IN THIS FILE
-- ---------------------------------------------------------------------------
-- A column nobody reads is worse than no column: `bk issues label list` would go
-- on returning every app's labels while the namespace in its spelling promised
-- otherwise. Every label READ in `apps/issues` now carries
-- `(app IS NULL OR app = 'issues')` and every label CREATE stamps the serving
-- app — see `lib/db/queries/labels.ts` and the enumeration of read paths in
-- `lib/db/queries/labels.app-scope.test.ts`.
--
-- Rollback: docs/sql/phase1e-labels-app-rollback.sql

ALTER TABLE "platform"."labels" ADD COLUMN IF NOT EXISTS "app" varchar(40);--> statement-breakpoint

ALTER TABLE "platform"."labels" DROP CONSTRAINT IF EXISTS "labels_app_apps_slug_fk";--> statement-breakpoint

ALTER TABLE "platform"."labels" ADD CONSTRAINT "labels_app_apps_slug_fk"
  FOREIGN KEY ("app") REFERENCES "platform"."apps"("slug") ON DELETE SET NULL;--> statement-breakpoint

-- The shape every label read now has: workspace first, then the app lens.
CREATE INDEX IF NOT EXISTS "idx_labels_workspace_app" ON "platform"."labels" USING btree ("workspace_id", "app");
