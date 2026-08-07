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

-- (1) The app may read its OWN schema. Derived from the role name rather than
--     hardcoded, so this file runs unchanged as any app's role.
\echo '\n(1) own schema readable — expect ok'
DO $probe1$
DECLARE t text; n bigint;
BEGIN
  SELECT quote_ident(schemaname) || '.' || quote_ident(tablename) INTO t
    FROM pg_tables WHERE schemaname = replace(session_user, '_app', '') LIMIT 1;
  IF t IS NULL THEN
    RAISE EXCEPTION '(1) FAILED: schema % has no tables — did the migration run?',
      replace(session_user, '_app', '');
  END IF;
  EXECUTE 'SELECT count(*) FROM ' || t INTO n;
  RAISE NOTICE '(1) ok: % readable (% rows)', t, n;
END
$probe1$;

-- (2) The app may NOT read ANOTHER app's schema. The important one, and the one
--     that cannot be written as a static query: the other app's table name is
--     not known here. So it finds one.
--
--     It SKIPS LOUDLY when no other app schema exists rather than passing
--     silently — this line was commented out entirely until 2026-08-05, when a
--     second schema first existed, and a commented-out probe is a probe that
--     reports success.
--
--     ── CLOSED 2026-08-07. THIS CHECK IS NO LONGER STRUCTURAL. ──────────────
--     CLAUDE.md's guardrail #6 is this check, and it has had three lives: a
--     comment (which reports success), then a live version whose candidate came
--     from a blocklist and picked `neon_auth.invitation` — a correct refusal of
--     the wrong thing, which reads identically to a pass — and now a candidate
--     drawn from `platform.apps`, i.e. from the registry that defines what an
--     app IS.
--
--     On 2026-08-07 the sales schema landed and it ran against a real second app
--     for the first time, as a real `sales_app` role rather than under SET ROLE:
--
--         (2) ok: issues.issues refused (42501)
--
--     Confirmed in both directions the same day — `issues_app` reading
--     `sales.prospects` is refused on the schema — because this is the one
--     people run one way round. It is now a real refusal of the right thing.
--
--     If it ever prints SKIPPED again, the app registry is wrong, not the probe.
\echo '\n(2) foreign schema refused — expect 42501'
DO $probe2$
DECLARE t text;
BEGIN
  -- Candidate schemas come from `platform.apps`, not from a list of names to
  -- exclude. A blocklist picked `neon_auth.invitation` on the first real run —
  -- a correct refusal of the wrong thing, which would have read as a pass while
  -- never touching another APP. The registry is the authority on what an app is.
  SELECT quote_ident(pt.schemaname) || '.' || quote_ident(pt.tablename) INTO t
    FROM pg_tables pt
    JOIN platform.apps a ON a.slug = pt.schemaname
   WHERE pt.schemaname <> replace(session_user, '_app', '')
   LIMIT 1;
  IF t IS NULL THEN
    RAISE NOTICE '(2) SKIPPED: no other app schema exists yet — this check is structural until one does';
    RETURN;
  END IF;
  BEGIN
    EXECUTE 'SELECT 1 FROM ' || t || ' LIMIT 1';
    RAISE EXCEPTION '(2) FAILED: % is READABLE by % — the app boundary is not there', t, session_user;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '(2) ok: % refused (42501)', t;
  END;
END
$probe2$;

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
