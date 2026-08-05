-- Phase 6 rollback — the cross-app primitives.
--
-- READ THIS FIRST: you probably do not need it.
--
-- Everything 0035 added is additive and inert to the pre-Phase-6 code. `entities`
-- and `links` are new tables nothing else reads; `events.app` and
-- `events.subject_urn` are nullable columns the old code never mentions. So the
-- first rollback is simply **promote the previous deployment**: the projection
-- stops being written, goes stale, and nothing breaks. Re-deploying forward and
-- running the reconciler (`bk super-admin entity-drift --repair`) repairs the
-- staleness in one pass — which is exactly the property the reconciler was built
-- in this phase to have.
--
-- This script is for the other case: rolling the *schema* back to re-apply a
-- corrected migration.
--
-- WHAT IS LOST. `entities` is derived and rebuilds from the source tables, so
-- dropping it costs nothing. `links` is NOT derived — it is the only original
-- data this phase creates, and every link anyone has made is gone for good. If
-- there is any chance of that mattering, dump it first:
--
--     \copy (SELECT * FROM platform.links) TO 'links-backup.csv' CSV HEADER
--
-- Run as the schema owner (neondb_owner); the app role has no DDL.
--
-- REHEARSED: see the Phase 6 report. Rehearsed on the Neon branch listed there,
-- immediately after applying 0035, and verified that `drizzle-kit migrate`
-- re-applies 0035 cleanly afterwards.

BEGIN;

-- 1. links first — it FKs into entities, and RESTRICT would refuse. Never reach
--    for CASCADE on entities: it would take the links silently instead of
--    telling you they were there.
DROP TABLE IF EXISTS "platform"."links";
DROP TABLE IF EXISTS "platform"."entities";

-- 2. The two events columns. Dropping `app` discards the producing-app tag on
--    every historical event; re-applying 0035 backfills it again as 'issues',
--    which is correct only for as long as issues is the only app that has run.
--    Once a second app has written events, this rollback loses information that
--    the backfill CANNOT reconstruct — check before running it.
ALTER TABLE "platform"."events" DROP CONSTRAINT IF EXISTS "events_app_apps_slug_fk";
DROP INDEX IF EXISTS "platform"."idx_events_ws_app";
DROP INDEX IF EXISTS "platform"."idx_events_ws_subject";
ALTER TABLE "platform"."events" DROP COLUMN IF EXISTS "app";
ALTER TABLE "platform"."events" DROP COLUMN IF EXISTS "subject_urn";

-- 3. Rewind the Drizzle ledger past 0035 so a later `migrate` re-applies it
--    rather than believing it is already done.
DELETE FROM "drizzle"."__drizzle_migrations"
 WHERE "hash" IN (
   SELECT "hash" FROM "drizzle"."__drizzle_migrations" ORDER BY "created_at" DESC LIMIT 1
 );

COMMIT;

-- 4. Verify: the first two must return zero rows, the third must return the
--    unchanged pre-rollback count (events are history and must not be touched).
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'platform' AND table_name IN ('entities','links');
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'platform' AND table_name = 'events'
--      AND column_name IN ('app','subject_urn');
--   SELECT count(*) FROM platform.events;
