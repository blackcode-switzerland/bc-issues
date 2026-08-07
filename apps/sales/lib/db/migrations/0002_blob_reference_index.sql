-- b/sales, migration 0002 — the blob-reference triggers.
--
-- ===========================================================================
-- THE ORDER OF THE LAST THREE SECTIONS IS THE ONLY IRREVERSIBLE THING IN THIS
-- PROJECT. READ THIS BEFORE MOVING A SINGLE STATEMENT.
-- ===========================================================================
--
--   1. TRIGGERS      — install them, so every future write maintains the index.
--   2. BACKFILL      — re-trigger every existing row, so the index describes
--                      what is actually there.
--   3. THE FLAG      — `platform.apps.maintains_blob_index = true`, which is
--                      this app telling EVERY OTHER DEPLOYMENT "you may trust
--                      my index instead of asking me".
--
-- Setting the flag before the backfill advertises an EMPTY index as
-- authoritative. Another deployment then asks "does sales reference this file?",
-- reads nothing, answers `false`, and calls Vercel Blob `del()`. There is no
-- undo. That is the whole content of this file; everything else is typing.
--
-- The `platform.apps` row itself is inserted with `enabled = false`
-- (docs/sql/sales-app-register.sql) and flipped to `true` only after this
-- migration has run. Registering an app that cannot answer for its references
-- stops blob deletion **platform-wide** — correctly, because nobody can prove a
-- file is unused. That is the gate working, not a bug.
--
-- ---------------------------------------------------------------------------
-- THE OTHER THING THAT CAN GO WRONG HERE
-- ---------------------------------------------------------------------------
-- A trigger that raises breaks the write it is attached to. These sit on almost
-- every content write the app makes, so an error inside
-- `platform.blob_refs_sync()` is an immediate, total outage of content editing,
-- not a degraded reference count. That is the cost of the guarantee; the benefit
-- is that no write path can forget the index.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE DOES NOT DEFINE
-- ---------------------------------------------------------------------------
-- `platform.blob_refs_sync`, `platform.is_uploaded_asset`,
-- `platform.extract_uploaded_urls` and `platform.blob_refs_purge` already exist —
-- `apps/issues` migration 0037 created them and they are platform-owned. A
-- second app INSTALLS TRIGGERS; it does not reimplement the recognizer. If this
-- migration errors on a missing function, the platform migrations have not been
-- applied to that database and that is the thing to fix.
--
-- ---------------------------------------------------------------------------
-- TWENTY-TWO COLUMNS, ELEVEN TRIGGERS, TEN TABLES
-- ---------------------------------------------------------------------------
-- The list is mirrored in `apps/sales/lib/storage/scanner.ts` (`SURFACES`), and
-- `lib/storage/scanner.test.ts` fails if the two disagree — because they are two
-- renderings of one list, and two hand-maintained lists are this codebase's
-- recurring silent-drift bug (D-27 trap 2).
--
-- `documents` carries TWO triggers on purpose: `scan` over its prose and `exact`
-- over its two url columns. One trigger name per (table, mode) pair, because a
-- table can only have one trigger of a given name.
--
-- Re-runnable: every trigger drop precedes its create, and the backfill
-- converges on the same rows.
-- Rollback: docs/sql/sales-0002-rollback.sql.

-- ---------------------------------------------------------------------------
-- 1. THE TRIGGERS
-- ---------------------------------------------------------------------------
-- `UPDATE OF <cols>` keeps the trigger off the many writes that touch other
-- columns (stage, status, owner, deleted_at, …). A SOFT DELETE assigns
-- `deleted_at`, which is deliberately not in any list below, so binning a row
-- does NOT drop its index entries — a binned row is restorable, so its files are
-- still in use. Same rule the scanner applies.

DROP TRIGGER IF EXISTS trg_blob_refs ON sales.prospects;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs
  AFTER INSERT OR DELETE OR UPDATE OF summary, next_action_note, closed_reason ON sales.prospects
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'sales', 'prospect', 'workspace_id', 'scan', 'summary', 'next_action_note', 'closed_reason');--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_blob_refs ON sales.contacts;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs
  AFTER INSERT OR DELETE OR UPDATE OF notes ON sales.contacts
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'sales', 'contact', 'workspace_id', 'scan', 'notes');--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_blob_refs ON sales.stage_entries;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs
  AFTER INSERT OR DELETE OR UPDATE OF note ON sales.stage_entries
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'sales', 'stage_entry', 'workspace_id', 'scan', 'note');--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_blob_refs ON sales.meetings;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs
  AFTER INSERT OR DELETE OR UPDATE OF title, agenda, outcome ON sales.meetings
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'sales', 'meeting', 'workspace_id', 'scan', 'title', 'agenda', 'outcome');--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_blob_refs ON sales.communications;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs
  AFTER INSERT OR DELETE OR UPDATE OF subject, body ON sales.communications
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'sales', 'communication', 'workspace_id', 'scan', 'subject', 'body');--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_blob_refs ON sales.objections;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs
  AFTER INSERT OR DELETE OR UPDATE OF spoken, real_fear, counter ON sales.objections
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'sales', 'objection', 'workspace_id', 'scan', 'spoken', 'real_fear', 'counter');--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_blob_refs ON sales.products;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs
  AFTER INSERT OR DELETE OR UPDATE OF description, pitch ON sales.products
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'sales', 'product', 'workspace_id', 'scan', 'description', 'pitch');--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_blob_refs ON sales.templates;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs
  AFTER INSERT OR DELETE OR UPDATE OF subject, body ON sales.templates
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'sales', 'template', 'workspace_id', 'scan', 'subject', 'body');--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_blob_refs ON sales.documents;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs
  AFTER INSERT OR DELETE OR UPDATE OF title, description ON sales.documents
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'sales', 'document', 'workspace_id', 'scan', 'title', 'description');--> statement-breakpoint

-- The second trigger on `documents`, in `exact` mode over the two url columns.
--
-- `external_url` is covered DELIBERATELY, and it is the least obvious line in
-- this file. The column is FOR external links, so most rows contribute nothing.
-- But nothing stops a caller putting a blob url there instead of in
-- `upload_url`, and `documents_one_location` then forbids the correct column —
-- so the schema's own CHECK creates the hole. A file referenced only from an
-- untriggered column is invisible to the delete gate, which is the one failure
-- that ends in lost bytes. `exact` mode runs `platform.is_uploaded_asset` on the
-- value, so a genuine Drive or Loom link produces no row: the cost is zero.
DROP TRIGGER IF EXISTS trg_blob_refs_url ON sales.documents;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs_url
  AFTER INSERT OR DELETE OR UPDATE OF upload_url, external_url ON sales.documents
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'sales', 'document_url', 'workspace_id', 'exact', 'upload_url', 'external_url');--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_blob_refs ON sales.matches;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs
  AFTER INSERT OR DELETE OR UPDATE OF why ON sales.matches
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync(
    'sales', 'match', 'workspace_id', 'scan', 'why');--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- GRANTS — the app role reads the index and may not write it
-- ---------------------------------------------------------------------------
-- `docs/sql/app-role.sql` runs ALTER DEFAULT PRIVILEGES granting full DML on
-- future tables in `platform`, so without this a new app role arrives with
-- INSERT/UPDATE/DELETE on the index and could erase a rival app's references —
-- the one direction of drift that ends in lost bytes. Revoke it back to SELECT.
--
-- Roles are derived from `platform.apps` and skipped when they do not exist, so
-- this is a no-op on a local or test database where the app connects as the
-- owner. Repeated from issues' 0037 because it must run again for EVERY new app
-- role, including this one.
--
-- ── AND THE `blob_refs_purge` GRANT, WHICH A NEW APP OTHERWISE NEVER GETS ────
-- Issues' 0038 revoked EXECUTE on `platform.blob_refs_purge` FROM PUBLIC and
-- then granted it to each app role that EXISTED AT THAT MOMENT. `sales_app` did
-- not, so without this loop it has no EXECUTE, and:
--
--   - `bk super-admin blob-drift --repair` cannot clear an ORPHANED reference
--     for sales — the one repair that has no source row left to re-trigger —
--     and fails with "permission denied for function" rather than anything that
--     names the real problem;
--   - check (4e) of `docs/sql/app-boundary-probe.sql` fails, and fails for the
--     WRONG REASON, which is worse: it expects a successful purge of the app's
--     OWN references and gets a privilege error, so a reader would take it as
--     the boundary working.
--
-- Found by running the probe as a real `sales_app` on 2026-08-07. Applying
-- 0038's own written mechanism to the second app; `docs/sql/app-role.sql` does
-- not mention it, which is reported for Phase 13.
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT a.slug || '_app' AS role_name
    FROM platform.apps a
    WHERE EXISTS (SELECT 1 FROM pg_roles p WHERE p.rolname = a.slug || '_app')
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform.blob_references FROM %I', r.role_name);
    EXECUTE format('GRANT SELECT ON platform.blob_references TO %I', r.role_name);
    EXECUTE format('GRANT EXECUTE ON FUNCTION platform.blob_refs_purge(text, text, bigint) TO %I', r.role_name);
  END LOOP;
END
$do$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. BACKFILL — by re-triggering, so it cannot disagree with the trigger
-- ---------------------------------------------------------------------------
-- `UPDATE t SET col = col` fires an `UPDATE OF col` trigger (it fires on the
-- column being ASSIGNED, not on the value changing), so the backfill is executed
-- by the exact code that will maintain the index from here on. Re-deriving it
-- with a hand-written INSERT … SELECT would be a second implementation of the
-- extraction rules, and a second implementation is a second thing that can
-- disagree. It is the same trick `bk super-admin blob-drift --repair` uses.
--
-- This app is new, so these are no-ops today. They are here anyway: this file
-- must be correct when it is re-run against a database that already has rows,
-- which is exactly what a rollback-and-reapply does.
UPDATE sales.prospects      SET summary = summary, next_action_note = next_action_note, closed_reason = closed_reason;--> statement-breakpoint
UPDATE sales.contacts       SET notes = notes;--> statement-breakpoint
UPDATE sales.stage_entries  SET note = note;--> statement-breakpoint
UPDATE sales.meetings       SET title = title, agenda = agenda, outcome = outcome;--> statement-breakpoint
UPDATE sales.communications SET subject = subject, body = body;--> statement-breakpoint
UPDATE sales.objections     SET spoken = spoken, real_fear = real_fear, counter = counter;--> statement-breakpoint
UPDATE sales.products       SET description = description, pitch = pitch;--> statement-breakpoint
UPDATE sales.templates      SET subject = subject, body = body;--> statement-breakpoint
UPDATE sales.documents      SET title = title, description = description, upload_url = upload_url, external_url = external_url;--> statement-breakpoint
UPDATE sales.matches        SET why = why;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. DECLARE COVERAGE — LAST, so it is only true once the index is built
-- ---------------------------------------------------------------------------
-- This flag is what lets ANOTHER deployment skip asking the sales deployment
-- whether it references a file. Setting it before the backfill would advertise
-- an empty index as authoritative, which is exactly how a file in use gets
-- deleted. It goes at the bottom of the file for that reason.
--
-- Guarded on the row existing: if `platform.apps` has no `sales` row yet this
-- updates nothing and stays correct, rather than inventing a row that would
-- register an app with no `base_url` and break `bk sales` on every machine.
UPDATE platform.apps SET maintains_blob_index = true WHERE slug = 'sales';
