-- Phase 8 follow-up: `platform.blob_refs_purge()` was not actually checking who
-- called it.
--
-- ---------------------------------------------------------------------------
-- THE BUG
-- ---------------------------------------------------------------------------
-- 0037 shipped the purge guard using `current_user`. **Inside a SECURITY DEFINER
-- function, `current_user` is the function's OWNER, not its caller.** So the
-- first branch of the guard —
--
--     is_owner := pg_has_role(current_user, <owner of blob_references>, 'USAGE')
--
-- — compared the owner against itself and was true for everybody. The whole
-- guard was inert: any app role could purge any other app's references, which is
-- the one direction of index damage that ends in a file being deleted while it
-- is still in use.
--
-- Verified rather than reasoned about, on a rehearsal branch, connected as the
-- real `issues_app` role:
--
--     SELECT current_user, session_user, platform.whoami_probe();
--     current_user | session_user |                inside
--     issues_app   | issues_app   | current_user=neondb_owner session_user=issues_app
--
-- `session_user` is the authenticated identity and is what the guard must use.
-- It is deliberately unaffected by `SET ROLE`, which is the right semantics here:
-- being able to assume a role is itself a privilege, and a session that has it is
-- not one this function should second-guess.
--
-- ---------------------------------------------------------------------------
-- HOW BADLY THIS BIT, AND WHY IT IS A SEPARATE MIGRATION
-- ---------------------------------------------------------------------------
-- Impact today: none. There is one app, so there is no other app's references to
-- erase, and the primary safety property never depended on this guard — app roles
-- hold SELECT on `blob_references` and nothing else, so the ONLY way to remove a
-- row is this function. The guard is the second layer, and it has to work before
-- app #2, not after.
--
-- It is 0038 rather than an edit to 0037 because 0037 has already been applied to
-- production. Editing an applied migration leaves the file saying one thing and
-- the database doing another, and a fresh database would silently get a different
-- schema from the live one. Applied migrations are history.
--
-- Additive and idempotent: one CREATE OR REPLACE plus grants. No table changes,
-- so no rollback script — re-applying 0037's version of the function restores the
-- previous (broken) behaviour, which is not something anyone should want.

CREATE OR REPLACE FUNCTION platform.blob_refs_purge(p_app text, p_type text, p_id bigint)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, platform AS $fn$
DECLARE
  n integer;
  -- session_user, NOT current_user. See the header — this is the entire fix.
  caller text := session_user;
  is_owner boolean := pg_catalog.pg_has_role(
    session_user,
    (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'platform.blob_references'::regclass),
    'USAGE');
  is_own_app boolean := session_user = p_app || '_app';
  -- `'platform'` rows (comments) belong to no single app, so any app role may
  -- repair one. They are also the rows every scanner already covers.
  is_shared boolean := p_app = 'platform'
    AND EXISTS (SELECT 1 FROM platform.apps a WHERE session_user = a.slug || '_app');
BEGIN
  IF NOT (is_owner OR is_own_app OR is_shared) THEN
    RAISE EXCEPTION 'blob_refs_purge: role % may not purge references held by app %', caller, p_app
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM platform.blob_references
   WHERE app = p_app AND source_type = p_type AND source_id = p_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;--> statement-breakpoint

-- Defence in depth: a new function is EXECUTE-able by PUBLIC by default. The
-- guard above is now correct, but nothing outside an app role or the migrator has
-- any business calling this at all, so say so explicitly rather than relying on
-- the guard being the only thing between a caller and a delete.
REVOKE EXECUTE ON FUNCTION platform.blob_refs_purge(text, text, bigint) FROM PUBLIC;--> statement-breakpoint

DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT a.slug || '_app' AS role_name
    FROM platform.apps a
    WHERE EXISTS (SELECT 1 FROM pg_roles p WHERE p.rolname = a.slug || '_app')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION platform.blob_refs_purge(text, text, bigint) TO %I', r.role_name);
  END LOOP;
END
$do$;
