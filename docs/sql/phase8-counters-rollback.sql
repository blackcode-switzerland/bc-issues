-- Phase 8 rollback — move `workspace_counters` back to `platform` (0040).
--
-- WHEN YOU NEED THIS: if you are rolling the deployment back to a build from
-- before 0040. Unlike the rest of Phase 8, that migration is NOT additive — old
-- code says `platform.workspace_counters` and fails the moment the table is not
-- there. Every issue, task and project create allocates a #number from it, so
-- the failure is immediate and total.
--
-- Run this BEFORE promoting such a build, not after.
--
-- `SET SCHEMA` moves the table back with its data, indexes, constraints and
-- ACLs. Nothing is lost in either direction; the move is a catalog update.
--
-- Run as the schema owner (neondb_owner); the app role has no DDL.

ALTER TABLE issues.workspace_counters SET SCHEMA platform;

-- Then remove 0040 from the Drizzle ledger so it can be re-applied later.
-- Check the row first — `created_at` is the journal timestamp (when the file was
-- generated), not when it was applied.
--
--   SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 3;
--   DELETE FROM drizzle.__drizzle_migrations WHERE id = <the 0040 row>;
