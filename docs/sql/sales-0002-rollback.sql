-- Rollback for apps/sales migration 0002 (the blob-reference triggers).
--
-- ===========================================================================
-- READ THIS FIRST. THE ORDER IS THE REVERSE OF 0002'S, AND FOR THE SAME REASON.
-- ===========================================================================
-- 0002 is triggers → backfill → flag. This is **flag → triggers → index rows**,
-- and the flag has to go FIRST.
--
-- `maintains_blob_index = true` is this app telling every other deployment "you
-- may trust my index instead of asking me". Drop the triggers while it is still
-- true and the index silently stops tracking new writes while every other
-- deployment keeps believing it — so a file embedded in a sales record after the
-- rollback looks unreferenced, and the next GC deletes it. Clearing the flag
-- first makes the gate REFUSE instead, which is the safe failure.
--
-- Refusing is not free: while `sales` is enabled with no coverage, **blob
-- deletion is refused in every deployment**. That is the intended state during a
-- rollback, and it is why step 0 exists.
--
-- ---------------------------------------------------------------------------
-- AND IT IS ONE TRANSACTION, FOR THE SAME REASON THE ORDER MATTERS
-- ---------------------------------------------------------------------------
-- Flag, triggers and index rows have to move TOGETHER. Half-applied — say the
-- flag cleared and the triggers still installed — is a state where the gate
-- refuses every delete platform-wide until somebody notices. `psql -f`
-- autocommits each statement, so without BEGIN/COMMIT any error in the middle
-- leaves exactly that. `\set ON_ERROR_STOP on` is the psql half; the
-- transaction is the half that works in every other client.
--
-- Rehearsed 2026-08-07 against the local Postgres: applied 0001+0002, ran this,
-- confirmed no `trg_blob_refs*` on any `sales` table, no `sales` rows in
-- `platform.blob_references`, and `maintains_blob_index = false`. Then re-ran
-- 0002 and confirmed the index rebuilt from the backfill.
\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. STOP THE GATE FROM ASKING. Optional, and the right call if the rollback
--    will last more than a few minutes: an app that is not enabled is not
--    consulted, so blob deletion works again everywhere else while you fix
--    whatever went wrong.
-- ---------------------------------------------------------------------------
-- UPDATE platform.apps SET enabled = false WHERE slug = 'sales';

-- ---------------------------------------------------------------------------
-- 1. THE FLAG. Before the triggers, always.
-- ---------------------------------------------------------------------------

UPDATE platform.apps SET maintains_blob_index = false WHERE slug = 'sales';

-- ---------------------------------------------------------------------------
-- 2. THE TRIGGERS. `platform.blob_refs_sync` itself is NOT dropped — it is
--    platform-owned, created by issues' 0037, and `apps/issues` is using it.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_blob_refs     ON sales.prospects;
DROP TRIGGER IF EXISTS trg_blob_refs     ON sales.contacts;
DROP TRIGGER IF EXISTS trg_blob_refs     ON sales.stage_entries;
DROP TRIGGER IF EXISTS trg_blob_refs     ON sales.meetings;
DROP TRIGGER IF EXISTS trg_blob_refs     ON sales.communications;
DROP TRIGGER IF EXISTS trg_blob_refs     ON sales.objections;
DROP TRIGGER IF EXISTS trg_blob_refs     ON sales.products;
DROP TRIGGER IF EXISTS trg_blob_refs     ON sales.templates;
DROP TRIGGER IF EXISTS trg_blob_refs     ON sales.documents;
DROP TRIGGER IF EXISTS trg_blob_refs_url ON sales.documents;
DROP TRIGGER IF EXISTS trg_blob_refs     ON sales.matches;

-- ---------------------------------------------------------------------------
-- 3. THE INDEX ROWS.
-- ---------------------------------------------------------------------------
-- Deletes only rows this app owns. `app = 'sales'` is the whole guard, and it is
-- enough: the primary key is (app, source_type, source_id, url), so no other
-- app's row can be reached from here.
--
-- Run as the MIGRATOR. The app role holds SELECT only on this table (0002's
-- grant block, and docs/sql/app-role.sql step 5b) — deliberately, because a role
-- that can delete from the index can unblock a delete that should have been
-- refused.
DELETE FROM platform.blob_references WHERE app = 'sales';

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY — all three must hold.
-- ---------------------------------------------------------------------------
--   SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'sales' AND NOT t.tgisinternal;          -- 0
--   SELECT count(*) FROM platform.blob_references WHERE app = 'sales';  -- 0
--   SELECT maintains_blob_index FROM platform.apps WHERE slug = 'sales'; -- f
--
-- To re-apply: delete this migration's row from the ledger, then migrate.
--   DELETE FROM drizzle.__drizzle_migrations_sales
--    WHERE created_at = 1786060860000;
--   npm run db:migrate --workspace=sales
