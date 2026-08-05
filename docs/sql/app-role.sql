-- Per-app Postgres role and grants.
--
-- This is step 2 of docs/adding-an-app.md and the thing that makes the app
-- boundary a DATABASE guarantee rather than a code-review convention: the
-- `sales` role simply has no SELECT on `issues.*`, so a mistake cannot reach
-- another app's data. See PLATFORM-ARCHITECTURE.md §4.3.
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

-- 1. The role.
CREATE ROLE issues_app LOGIN PASSWORD '<password>';

-- 2. Reach the schemas. USAGE alone grants nothing inside them.
GRANT USAGE ON SCHEMA platform, issues TO issues_app;

-- 3. Data access. Note: NO TRUNCATE, NO REFERENCES, NO TRIGGER — DML only.
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
