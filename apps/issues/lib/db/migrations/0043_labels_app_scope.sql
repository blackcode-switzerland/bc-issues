-- Phase 1e-3 (D-14): `platform.labels.app` — labels become app-scoped.
--
-- ---------------------------------------------------------------------------
-- WHAT THE COLUMN MEANS
-- ---------------------------------------------------------------------------
--   set   — scoped: only that app lists it, attaches it, renames it, deletes it.
--   NULL  — shared: visible to every app in the workspace.
--
-- **TO SHARE A LABEL, SET `app` BACK TO NULL.** There is no command for it and
-- the column will not tell you, so it is written here:
--
--     UPDATE platform.labels SET app = NULL WHERE id = <id>;
--
-- That is deliberately a manual act. Sharing is a decision somebody makes about
-- one label, not a state a label drifts into.
--
-- ---------------------------------------------------------------------------
-- WHY THE BACKFILL IS HERE
-- ---------------------------------------------------------------------------
-- The first draft of this migration added the column and backfilled nothing, on
-- the grounds that it was the honest expand step. It was the honest HALF step:
-- D-14's whole stated motivation is that *"issues' labels pollute sales' picker
-- and vice versa"*, and with every existing row left NULL that stays true on the
-- day the second app opens. The column would have shipped without the effect it
-- exists to produce, and the missing half is the visible one.
--
-- So every existing row becomes `'issues'`, and three things make that safe
-- rather than merely convenient:
--
--   1. It RECORDS A FACT rather than making a change. Every one of these labels
--      was created by the issues app, in the issues UI, for issues work.
--      `app = 'issues'` is a true statement about all of them.
--   2. It is invisible to the deploy window, unlike 0041's backfill. The build
--      running before this one has no app filter at all — it reads every label
--      regardless of the column — so nothing it shows changes.
--   3. It is reversible per label, with the one-liner at the top of this file.
--      The other direction is not: discovering the pollution after the second
--      app launches means bulk-classifying under time pressure with users
--      watching.
--
-- "Zero shared labels" is the intended starting state, not an oversight. It is
-- the state in which every shared label that ever exists is a deliberate act.
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
CREATE INDEX IF NOT EXISTS "idx_labels_workspace_app" ON "platform"."labels" USING btree ("workspace_id", "app");--> statement-breakpoint

-- MIGRATE. Every label that exists today was created by this app; say so.
--
-- Bounded by `app IS NULL`, so re-running it is a no-op — but note that once a
-- second app is registered this statement is NO LONGER SAFE TO RE-RUN BY HAND:
-- it would claim any label that app has deliberately shared. Re-running the
-- migration file is fine (drizzle's ledger stops it); typing this UPDATE at a
-- psql prompt in 2027 is not.
UPDATE "platform"."labels" SET "app" = 'issues' WHERE "app" IS NULL;
