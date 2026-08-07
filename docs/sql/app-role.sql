-- Per-app Postgres role and grants.
--
-- This is step 2 of docs/adding-an-app.md and the thing that makes the app
-- boundary a DATABASE guarantee rather than a code-review convention: the
-- `sales` role simply has no SELECT on `issues.*`, so a mistake cannot reach
-- another app's data. See platform-architecture.md §4.3.
--
-- Run it as the schema owner (on Neon that is `neondb_owner`).
-- Substitute <app> and <password> — never commit a real password.
--
-- ---------------------------------------------------------------------------
-- WHO OWNS WHAT, AND WHY IT MATTERS
-- ---------------------------------------------------------------------------
-- The app role must NOT own the tables. Ownership is what confers DDL rights:
-- an owner can ALTER or DROP, including tables in `platform` that every other
-- app depends on. Splitting "the role that migrates" from "the role the app
-- runs as" is what stops one app silently reshaping shared schema.
--
--   neondb_owner  — the MIGRATOR. Owns both schemas and every table. Used by
--                   `drizzle-kit migrate` and by this script. Not used by the app.
--   <app>_app     — the APP role. DML only (SELECT/INSERT/UPDATE/DELETE) and
--                   sequence usage. Owns nothing, so it cannot ALTER or DROP.
--
-- We use Neon's built-in `neondb_owner` as the migrator rather than minting a
-- third role: it already owns everything, and a separate owner would mean
-- another credential to rotate for no additional guarantee. What the rule
-- actually requires is that the APP role owns nothing, which is asserted below.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- \set ON_ERROR_STOP on, AND STEP 1b. NEITHER IS DECORATION.
-- ---------------------------------------------------------------------------
-- This file was written for `issues`, whose schema was created by migration 0033
-- long before anybody wrote a role script for it — so the assumption that the
-- schema already exists was invisible and correct for the only app there was.
--
-- It is wrong for every app after the first. Rehearsed 2026-08-07 with the sales
-- copy of this file, run at the documented point (before the app's first
-- migration, which is what creates the schema):
--
--     ERROR:  schema "sales" does not exist        <- x5, once per grant
--     PSQL EXIT=0
--
-- Steps 2 to 5 are every grant the role has. All five failed, `psql` exited 0,
-- and the app role came out with NOTHING while provisioning reported success.
-- That is CLAUDE.md finding #7 — 27 errors and exit 0 — in a provisioning
-- script, found by running it rather than reading it.
\set ON_ERROR_STOP on

-- 1. The role.
CREATE ROLE issues_app LOGIN PASSWORD '<password>';

-- 1b. The schema — **BEFORE the grants, because steps 2 to 5 all name it.**
--     `IF NOT EXISTS`, and an app's first migration should open with the same
--     statement, so it does not matter which of the two gets there first. Owned
--     by the MIGRATOR: the app role must own nothing (see above).
CREATE SCHEMA IF NOT EXISTS issues AUTHORIZATION neondb_owner;

-- 2. Reach the schemas. USAGE alone grants nothing inside them.
GRANT USAGE ON SCHEMA platform, issues TO issues_app;

-- 3. Data access. Note: NO TRUNCATE, NO REFERENCES, NO TRIGGER — DML only.
--
--    `ON ALL TABLES` means "all tables that exist RIGHT NOW". For a NEW app the
--    schema step 1b just created is empty, so this line grants nothing in it —
--    correct, and not a gap: step 5 is what covers the tables the first
--    migration is about to create. Verified in the 2026-08-07 rehearsal: after
--    the migrations, with no re-grant of any kind, the app role could read the
--    new tables and held USAGE on every new sequence. **Do not delete step 5
--    because this line looks sufficient.**
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform, issues TO issues_app;

-- 4. Sequences. Easy to forget and the failure is confusing: every INSERT into
--    a table with a `serial` primary key fails with "permission denied for
--    sequence" even though the INSERT grant is present.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform, issues TO issues_app;

-- 5. Future objects. Without this, the next migration creates a table the app
--    cannot read, and the failure surfaces at runtime rather than at deploy.
--    ALTER DEFAULT PRIVILEGES applies per granting role, so it must be run as
--    the role that will create those objects — the migrator.
ALTER DEFAULT PRIVILEGES IN SCHEMA platform, issues
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO issues_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform, issues
  GRANT USAGE, SELECT ON SEQUENCES TO issues_app;

-- 5b. THE ONE EXCEPTION TO STEP 5: `platform.blob_references`.
--
--    The default privileges above hand every future `platform` table full DML to
--    the app role. That is wrong for exactly one table. `blob_references` is how
--    each app proves to the OTHERS what files it still points at, and a role with
--    DELETE on it could erase a rival app's references — after which a delete
--    that should have been refused goes ahead and the bytes are gone. It is
--    written only by the SECURITY DEFINER triggers migration 0037 installs, so
--    the app never needs to write it itself.
--
--    Run this AFTER step 5, and re-run it for every new app role.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform.blob_references FROM issues_app;
GRANT SELECT ON platform.blob_references TO issues_app;

-- 6. search_path is a safety net, not the mechanism. Drizzle writes every table
--    schema-qualified; this only stops an unqualified ad-hoc query from silently
--    finding nothing. `public` is deliberately absent — nothing lives there now.
ALTER ROLE issues_app SET search_path = platform, issues;

-- 7. The app must never migrate. It has no rights on the Drizzle ledger, so a
--    stray `drizzle-kit migrate` with the app credentials fails loudly instead
--    of half-applying.
REVOKE ALL ON SCHEMA drizzle FROM issues_app;

-- ---------------------------------------------------------------------------
-- ASSERTIONS — run these after the grants. Each must return zero rows.
-- ---------------------------------------------------------------------------

-- (a) The app role owns nothing.
--   SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
--   WHERE r.rolname = 'issues_app';

-- (b) The app role has no DDL-implying privilege anywhere.
--   SELECT table_schema, table_name, privilege_type
--   FROM information_schema.table_privileges
--   WHERE grantee = 'issues_app' AND privilege_type NOT IN
--     ('SELECT','INSERT','UPDATE','DELETE');

-- (c) A role with no grant on `issues` is REFUSED. Create a throwaway role and
--     confirm the SELECT fails — an untested boundary is not a boundary.
--   CREATE ROLE probe_app LOGIN PASSWORD '...';
--   GRANT USAGE ON SCHEMA platform TO probe_app;   -- deliberately NOT issues
--   -- then, as probe_app:  SELECT * FROM issues.issues LIMIT 1;  -> must fail 42501

-- (d) RUN docs/sql/app-boundary-probe.sql AS THE NEW APP ROLE. Not optional, and
--     not replaceable by `SET ROLE` from the owner: `session_user` ignores
--     SET ROLE, and inside a SECURITY DEFINER function `current_user` is the
--     function's owner rather than the caller — so a SET ROLE probe reports the
--     boundary as present when it is not.
--
--     That is not hypothetical. The blob-index purge guard shipped in 0037
--     checking `current_user` and was therefore inert: any app could purge any
--     other app's references, the one kind of index damage that ends in deleted
--     bytes. It was found by running the probe as the real role, and fixed in
--     0038. Connect as the app and run it:
--
--       psql "postgres://<app>_app:<pw>@<host>/<db>" -f docs/sql/app-boundary-probe.sql
--
--     **AFTER the app's first migration, not straight after this file.** The
--     probe's check (1) reads a table out of the app's schema, and there are
--     none until the migration runs.
--
--     And read the probe's `ok` lines rather than counting its errors: a role
--     that was granted nothing at all ALSO denies everything with 42501 and
--     passes six of its eight denial checks. Its header carries both transcripts
--     side by side.
