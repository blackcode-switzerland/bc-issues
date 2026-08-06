-- Phase 1e-2 (D-14): `platform.deletion_batches.root_type` becomes `<app>:<noun>`.
--
-- The same change as 0041, on the recycle bin's batch header, for the same
-- reason: the CHECK enumerated one app's three nouns in a table every app
-- shares. Read 0041's header for why the constraint validates the SHAPE rather
-- than the vocabulary, what it deliberately does not reject, and where 81 comes
-- from. Everything there applies here verbatim.
--
-- Two differences from 0041, both small:
--
--  1. `root_type` is NOT NULL, so there is no IS NULL branch.
--
--  2. No read path FILTERS on `root_type` — it is selected, aliased to
--     `batch_root_type`, and compared in the client against the item's own bare
--     `type` (`components/trash-view.tsx`, the "which row is the batch root"
--     lookup). That comparison is why `apps/issues` strips the `issues:` prefix
--     on the way OUT of the query layer instead of qualifying the wire format:
--     a qualified `batch_root_type` would never equal a bare `type` again, and
--     the fallback (`?? items[0]`) means it would have failed SILENTLY, picking
--     an arbitrary row as the batch root. See `lib/db/queries/qualified-type.ts`.
--
-- DEPLOY ORDERING: same as 0041 — the backfill is invisible to the new build
-- and visible to the old one, so chain the migration and the promote.
--
-- Rollback: docs/sql/phase1e-deletion-batches-root-type-rollback.sql

ALTER TABLE "platform"."deletion_batches" DROP CONSTRAINT IF EXISTS "deletion_batches_root_type_check";--> statement-breakpoint

ALTER TABLE "platform"."deletion_batches" ALTER COLUMN "root_type" TYPE varchar(81);--> statement-breakpoint

ALTER TABLE "platform"."deletion_batches" ADD CONSTRAINT "deletion_batches_root_type_check" CHECK (
  -- LEGACY, dropped at the contract step.
  "root_type" IN ('project', 'task', 'issue')
  OR "root_type" ~ '^[a-z][a-z0-9_-]{0,39}:[a-z][a-z0-9_-]{0,39}$'
);--> statement-breakpoint

-- MIGRATE. Bounded by the legacy literals; re-running it is a no-op.
UPDATE "platform"."deletion_batches"
   SET "root_type" = 'issues:' || "root_type"
 WHERE "root_type" IN ('project', 'task', 'issue');
