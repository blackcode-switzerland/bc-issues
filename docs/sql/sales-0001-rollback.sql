-- Rollback for apps/sales migration 0001 (the schema).
--
-- ===========================================================================
-- RUN docs/sql/sales-0002-rollback.sql FIRST. THIS SCRIPT REFUSES OTHERWISE.
-- ===========================================================================
-- `DROP SCHEMA sales CASCADE` takes the tables and their triggers with it, but
-- it does NOT touch `platform.blob_references` — those rows have no foreign key
-- to anything (deliberately: deregistering an app must not silently drop its
-- references and unblock a delete). So dropping the schema on its own leaves
-- `sales` rows in the index pointing at source rows that no longer exist, while
-- `maintains_blob_index` still claims the index is authoritative.
--
-- The effect is the safe direction — an orphaned reference makes a file
-- undeletable, not deletable — but it is an unbounded, invisible leak in the one
-- subsystem CLAUDE.md names as standing between a code change and unrecoverable
-- data loss. `bk super-admin blob-drift` cannot clear it either: with the schema
-- gone there is no source to re-trigger and no scanner to compare against.
--
-- The guard below is a `DO` block rather than a comment, because a commented-out
-- check reports success (CLAUDE.md finding #6).
--
-- Rehearsed 2026-08-07 against the local Postgres, in both orders. **The first
-- rehearsal failed, and not in the way the guard was written to fail** — see the
-- transaction note below. It now completes when 0002 has been rolled back first,
-- and refuses AND CHANGES NOTHING when it has not.

-- ---------------------------------------------------------------------------
-- ONE TRANSACTION. THE GUARD ABOVE IS INERT WITHOUT IT.
-- ---------------------------------------------------------------------------
-- Found by rehearsing this file, which is the only way it could have been found.
-- `psql -f` autocommits each statement, so a `RAISE EXCEPTION` prints ERROR,
-- **psql carries straight on to the next statement**, and psql still EXITS 0.
-- The first rehearsal watched this guard refuse in capital letters and then drop
-- the schema anyway, one statement later, reporting success.
--
-- That is CLAUDE.md finding #7 exactly — `pg_dump --schema=issues` restoring
-- with 27 errors and exit 0 — reproduced by a script written to avoid it, by
-- someone who had just read the finding. #8's lesson holds: you cannot tell by
-- looking, including at your own.
--
-- `\set ON_ERROR_STOP on` covers psql; BEGIN/COMMIT makes it atomic in every
-- other client too. Belt and braces, because the failure is silent and the thing
-- it protects is unrecoverable.
\set ON_ERROR_STOP on
BEGIN;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM platform.blob_references WHERE app = 'sales') THEN
    RAISE EXCEPTION
      'REFUSING: platform.blob_references still holds % row(s) for app ''sales''. '
      'Run docs/sql/sales-0002-rollback.sql first — dropping the schema now would '
      'orphan them permanently, with no source row left to re-trigger and no '
      'scanner left to reconcile against.',
      (SELECT count(*) FROM platform.blob_references WHERE app = 'sales');
  END IF;

  IF EXISTS (SELECT 1 FROM platform.apps WHERE slug = 'sales' AND maintains_blob_index) THEN
    RAISE EXCEPTION
      'REFUSING: platform.apps.maintains_blob_index is still true for ''sales''. '
      'Every other deployment believes this app''s index speaks for it. Run '
      'docs/sql/sales-0002-rollback.sql first.';
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 1. Deregister. Before the drop, so no gate consults an app whose tables are
--    about to vanish.
-- ---------------------------------------------------------------------------
-- Not a DELETE: `platform.uploads.app`, `platform.labels.app` and
-- `platform.workspace_invitations.app` reference `apps.slug` ON DELETE SET NULL,
-- so removing the row would silently un-scope every sales label and re-attribute
-- every sales upload to nobody. Disabling is reversible; deleting is not.
UPDATE platform.apps SET enabled = false WHERE slug = 'sales';

-- ---------------------------------------------------------------------------
-- 2. Cross-app leftovers this app wrote into PLATFORM tables.
-- ---------------------------------------------------------------------------
-- `sales.*` disappears with the schema. These do not — they live in `platform`
-- and are keyed by app, so nothing else removes them.
--
-- `platform.entities` cascades to `platform.links`, which is intended: a link to
-- an entity that no longer exists is a dangling URN, and the schema already made
-- that call.
DELETE FROM platform.entities WHERE app = 'sales';

-- Events are HISTORY and are deliberately NOT deleted. `bk activity --app sales`
-- over a removed app is an empty-ish feed of things that really happened; a
-- rollback is not a reason to rewrite the record. Uncomment only if the app is
-- being removed for good rather than rolled back:
-- DELETE FROM platform.events WHERE app = 'sales';

-- ---------------------------------------------------------------------------
-- 3. The schema.
-- ---------------------------------------------------------------------------
DROP SCHEMA IF EXISTS sales CASCADE;

-- `sales.words()` goes with the schema (it is defined inside it), so there is
-- nothing separate to drop. Platform functions — `blob_refs_sync`,
-- `is_uploaded_asset`, `extract_uploaded_urls`, `blob_refs_purge` — are NOT
-- ours and must survive: `apps/issues` is using them.

-- ---------------------------------------------------------------------------
-- 4. The migration ledger, so a re-apply actually re-applies.
-- ---------------------------------------------------------------------------
-- Sales has its OWN ledger table — see the header of apps/sales/drizzle.config.ts
-- for why sharing `drizzle.__drizzle_migrations` silently skips migrations.
-- Dropping the table is right here: it exists only for this app.
DROP TABLE IF EXISTS drizzle.__drizzle_migrations_sales;

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
--   SELECT nspname FROM pg_namespace WHERE nspname = 'sales';              -- 0 rows
--   SELECT count(*) FROM platform.blob_references WHERE app = 'sales';     -- 0
--   SELECT count(*) FROM platform.entities WHERE app = 'sales';            -- 0
--   SELECT enabled, maintains_blob_index FROM platform.apps WHERE slug='sales'; -- f, f
--
-- And the thing that matters to everyone else: blob deletion works again,
-- because a disabled app is not consulted.
