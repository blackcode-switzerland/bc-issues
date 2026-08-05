-- Does the app boundary actually deny? Run this AS THE APP ROLE.
--
--     psql "postgres://<app>_app:<password>@<host>/<db>" -f docs/sql/app-boundary-probe.sql
--
-- Step 2 of docs/adding-an-app.md, and not optional: an untested boundary is not
-- a boundary. Every statement below is wrapped so the script reports rather than
-- stops, and every write is rolled back, so it is safe against any database —
-- including production, though a rehearsal branch is the polite choice.
--
-- ---------------------------------------------------------------------------
-- WHY THIS FILE EXISTS RATHER THAN A TEST IN CI
-- ---------------------------------------------------------------------------
-- The properties here can only be observed by a session AUTHENTICATED as the app
-- role. `SET ROLE` is not a substitute and quietly gives the wrong answer:
-- `session_user` ignores `SET ROLE` by design, and inside a SECURITY DEFINER
-- function `current_user` is the function's owner. CI has no app-role
-- credential, so this is a checklist step with a script, not a unit test.
--
-- It was written because probe (d) below FAILED the first time it was run.
-- `platform.blob_refs_purge` guarded on `current_user`, which inside a SECURITY
-- DEFINER function is the owner, never the caller — so the guard was inert and
-- any app could purge any other app's blob references. Migration 0038 fixes it.
-- Nothing but running this as the real role would have shown that.
--
-- EXPECTED: every line prints `ok`. Anything else is a boundary that is not
-- there.

\set ON_ERROR_STOP off
\echo '--- app boundary probe, running as:'
SELECT current_user AS connected_as, session_user;

-- (1) The app may read and write its OWN schema. (Substitute your app's table.)
\echo '\n(1) own schema readable — expect a count'
SELECT count(*) AS rows FROM issues.issues;

-- (2) The app may NOT read another app's schema. With one app there is nothing
--     to point at yet; keep this and fill it in the moment app #2 exists.
--     Expect: ERROR 42501 permission denied for schema/table.
-- \echo '\n(2) foreign schema refused — expect 42501'
-- SELECT count(*) FROM sales.quotes;

-- (3) The app owns nothing, so it can do no DDL. Expect: ERROR 42501.
\echo '\n(3) DDL refused — expect 42501'
BEGIN;
CREATE TABLE platform.boundary_probe_should_fail (x int);
ROLLBACK;

-- (4) THE BLOB INDEX. The app may READ it and may not WRITE it: the triggers are
--     the only writer, so no app can forge a reference for another app or erase
--     one. Erasing is the direction that ends in a file being deleted while it
--     is still in use.
\echo '\n(4a) index readable — expect a count'
SELECT count(*) AS blob_references FROM platform.blob_references;

\echo '\n(4b) forging a foreign reference — expect 42501'
BEGIN;
INSERT INTO platform.blob_references (url, app, source_type, source_id)
VALUES ('https://probe.blob.vercel-storage.com/x.png', 'not-this-app', 'probe', 1);
ROLLBACK;

\echo '\n(4c) erasing a foreign reference — expect 42501'
BEGIN;
DELETE FROM platform.blob_references WHERE app <> current_user;
ROLLBACK;

\echo '\n(4d) purging ANOTHER app''s references — expect 42501 from blob_refs_purge'
BEGIN;
SELECT platform.blob_refs_purge('not-this-app', 'probe', 1);
ROLLBACK;

\echo '\n(4e) purging its OWN references — expect success, 0 rows'
BEGIN;
SELECT platform.blob_refs_purge(replace(current_user, '_app', ''), 'probe', 999999999) AS purged;
ROLLBACK;

-- (5) The app must never migrate. Expect: ERROR 42501 on the Drizzle ledger, so
--     a stray `drizzle-kit migrate` with app credentials fails loudly rather
--     than half-applying.
\echo '\n(5) migration ledger refused — expect 42501'
SELECT count(*) FROM drizzle.__drizzle_migrations;

\echo '\n--- probe complete. Every deny above must be 42501.'
