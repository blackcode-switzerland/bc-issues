-- The scaffold app, migration 0002 — the blob-reference trigger and the flag.
--
-- ===========================================================================
-- READ THIS BEFORE CHANGING ANYTHING IN THIS FILE. THE ORDER IS THE POINT.
-- ===========================================================================
-- `platform.blob_references` is how each app proves to the OTHERS which files it
-- still points at. A file nobody references can be deleted; a file this app
-- references must not be. CLAUDE.md names this subsystem and
-- `packages/platform-storage/src/references.ts` as the two things standing
-- between a code change and unrecoverable data loss.
--
-- This migration is THREE STEPS AND THEY DO NOT COMMUTE:
--
--   1. THE TRIGGERS   — start recording references for every future write
--   2. THE BACKFILL   — record references for rows that already exist
--   3. THE FLAG       — `platform.apps.maintains_blob_index = true`, which is
--                       this app telling every other deployment "you may trust
--                       my index instead of asking me"
--
-- Set the flag BEFORE the backfill and you have advertised an EMPTY index as
-- authoritative. Every other deployment then believes no file is referenced
-- here, and the next garbage collection deletes files this app is using. There
-- is no undo. That is why the flag is the last statement in the file.
--
-- ── WHY THE TRIGGER AND NOT THE WRITE PATH ────────────────────────────────
-- Because a write path can forget, and a trigger cannot. Every route, every
-- script, every hand-run UPDATE in psql maintains the index automatically. The
-- whole remaining risk is therefore concentrated in this one file, which is why
-- `docs/adding-an-app.md` step 4 says any new column that can hold a file URL
-- needs a trigger IN THE SAME MIGRATION as the column.
--
-- Re-runnable: the drop precedes the create, and the backfill converges.

-- ---------------------------------------------------------------------------
-- 1. THE TRIGGER
-- ---------------------------------------------------------------------------
-- `UPDATE OF body` keeps the trigger off writes that touch other columns
-- (title, updated_at, …). **`deleted_at` is deliberately NOT in the list**: a
-- soft delete assigns it, and binning a row must NOT drop its index entries —
-- a binned row is restorable, so its files are still in use. The scanner applies
-- the same rule, and the two agreeing is what makes restore safe.
--
-- `platform.blob_refs_sync` is platform-owned, created by issues' 0037. It is
-- NOT created here and must not be dropped by this app's rollback.
DROP TRIGGER IF EXISTS trg_blob_refs ON scaffold.notes;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs
  AFTER INSERT OR DELETE OR UPDATE OF body ON scaffold.notes
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'scaffold', 'note', 'workspace_id', 'scan', 'body');--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. THE BACKFILL — rows written before the trigger existed
-- ---------------------------------------------------------------------------
-- A no-op UPDATE fires the AFTER UPDATE trigger, which is the least surprising
-- way to make existing rows account for themselves: one implementation of the
-- extraction, not two. `WHERE body IS NOT NULL` keeps it off rows that cannot
-- carry a URL.
UPDATE scaffold.notes SET body = body WHERE body IS NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2b. THE `blob_refs_purge` GRANT, WHICH A NEW APP OTHERWISE NEVER GETS
-- ---------------------------------------------------------------------------
-- Issues' 0038 revoked EXECUTE on `platform.blob_refs_purge` FROM PUBLIC and
-- granted it to each app role that existed AT THAT MOMENT. Every app created
-- since arrives with none — and `bk super-admin blob-drift --repair` then cannot
-- clear an ORPHANED reference (the one repair with no source row left to
-- re-trigger), failing with "permission denied for function" rather than
-- anything that names the problem.
--
-- Derived from `platform.apps` and skipped where the role does not exist, so
-- this is safe to run in any order relative to role provisioning.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT a.slug || '_app' AS role_name
      FROM platform.apps a
     WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = a.slug || '_app')
  LOOP
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION platform.blob_refs_purge(text, text, bigint) TO %I',
      r.role_name);
  END LOOP;
END
$$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. DECLARE COVERAGE — LAST, so it is only true once the index is built
-- ---------------------------------------------------------------------------
-- Guarded on the row existing: if `platform.apps` has no row for this app yet,
-- this updates nothing and stays correct, rather than inventing a row that would
-- register an app with no `base_url` and break `bk <app>` on every machine.
--
-- **If you register the app AFTER running this migration, the flag is never set
-- and re-running the migration will not fix it** — Drizzle records it as
-- applied. Recovery is a hand-written UPDATE. Register first; see
-- docs/adding-an-app.md §2.
UPDATE platform.apps SET maintains_blob_index = true WHERE slug = 'scaffold';
