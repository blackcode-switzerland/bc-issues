-- Phase 8: `workspace_counters` moves out of `platform` and into `issues`.
--
-- ---------------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------------
-- Its columns are `last_issue_seq`, `last_project_seq`, `last_task_seq` — one
-- app's entity types, in the schema that is supposed to hold only what every app
-- shares. A second app could not allocate a #number without ALTERing a platform
-- table, which is precisely the app→platform coupling Phase 3 spent its whole
-- budget removing. It survived Phase 3 only because Phase 3 moved tables out of
-- `public` without re-asking which side of the line each one belonged on.
--
-- PLATFORM-ARCHITECTURE.md §4.6 used to prescribe the other fix: reshape it to
-- `(workspace_id, app, entity_type, last_seq)` so every app could share one
-- table. Building `apps/_template` showed that to be the wrong trade. Sharing a
-- counter buys nothing — no query ever spans two apps' counters — and costs a
-- shared write point and a shared migration for every new entity type anyone
-- adds. Apps should not share it at all. §4.6 has been rewritten to record the
-- decision that actually won, so the next person does not re-litigate it from a
-- doc prescribing the rejected design.
--
-- ---------------------------------------------------------------------------
-- WHAT `SET SCHEMA` DOES AND DOES NOT DO
-- ---------------------------------------------------------------------------
-- It MOVES the table: data, indexes, constraints, ownership and ACLs all travel
-- with it, and the cross-schema foreign key to `platform.workspaces` stays valid
-- (Phase 3 did 26 of these and verified exactly that). It is a catalog update,
-- not a copy, so it is fast and atomic regardless of table size.
--
-- The one thing that DOES change is reachability: after the move, a role with
-- USAGE on `platform` but not on `issues` can no longer see it. That is the
-- point — the counter is this app's data — and it is why the grants are
-- re-asserted below rather than assumed. `issues_app` already has blanket DML on
-- the `issues` schema, so this is belt-and-braces; a future app role has no
-- grant here at all, which is correct.
--
-- BREAKING FOR OLD CODE. Unlike everything else in Phase 8, this is NOT additive:
-- a build that still says `platform.workspace_counters` fails the moment this
-- lands. That makes it a MIGRATE-FIRST cutover — the migration and the promote
-- must be chained (`&&`), exactly as Phase 3 was. Do not apply it hours before
-- the deploy.
--
-- Rollback: docs/sql/phase8-counters-rollback.sql (one `SET SCHEMA` back).

ALTER TABLE "platform"."workspace_counters" SET SCHEMA "issues";--> statement-breakpoint

-- Re-assert the grant in its new home. `ALTER DEFAULT PRIVILEGES` covers tables
-- CREATED in a schema, not ones moved into it, so a moved table can arrive
-- carrying only the ACL it had before. It is the same ACL here, but stating it
-- costs nothing and makes the invariant checkable.
--
-- Roles are derived from `platform.apps` (`<slug>_app`) and skipped when absent,
-- so this is a no-op on a local or test database that connects as the owner.
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT a.slug || '_app' AS role_name
    FROM platform.apps a
    WHERE a.slug = 'issues'
      AND EXISTS (SELECT 1 FROM pg_roles p WHERE p.rolname = a.slug || '_app')
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON issues.workspace_counters TO %I', r.role_name);
  END LOOP;
END
$do$;
