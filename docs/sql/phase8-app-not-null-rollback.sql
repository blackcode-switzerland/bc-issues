-- Phase 8 rollback — re-loosen `app` to NULLABLE (migration 0039).
--
-- WHEN YOU NEED THIS: only if you are rolling the DEPLOYMENT back to a build
-- from before Phase 6 / Phase 7. That code inserts `platform.events` rows with
-- no `app`, and `platform.uploads` rows likewise, so with 0039 applied every
-- write would fail — a total outage rather than a degraded one.
--
-- Run this BEFORE promoting such a build, not after.
--
-- Rolling back to any Phase 6+ build needs nothing: that code always sets `app`,
-- which is the precondition 0039 was applied on in the first place.
--
-- Losing nothing: this only removes a constraint. Existing values stay.
--
-- Run as the schema owner (neondb_owner); the app role has no DDL.

ALTER TABLE platform.events  ALTER COLUMN app DROP NOT NULL;
ALTER TABLE platform.uploads ALTER COLUMN app DROP NOT NULL;

-- Then remove 0039 from the Drizzle ledger so it can be re-applied later.
-- Check the row before deleting it — `created_at` is the journal timestamp
-- (when the file was generated), not when it was applied.
--
--   SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 3;
--   DELETE FROM drizzle.__drizzle_migrations WHERE id = <the 0039 row>;
