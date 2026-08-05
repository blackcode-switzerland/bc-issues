-- Read-only drift check for `platform.blob_references`, with no deploy required.
--
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS ALONGSIDE `bk super-admin blob-drift`
-- ---------------------------------------------------------------------------
-- The CLI command is the real reconciler and the one to use once the code is
-- live. But migration 0037 is applied to production BEFORE the deploy that ships
-- that route — deliberately, to buy a soak period in which the triggers are
-- exercised by real production writes while nothing yet reads the index (no app
-- is answered for by it until `maintains_blob_index` is honoured by deployed
-- code). During that window the route does not exist, so the soak needs a check
-- that runs against the database alone. This is it.
--
-- ---------------------------------------------------------------------------
-- HOW IT WORKS, AND WHY IT IS NOT A THIRD COPY OF THE RULES
-- ---------------------------------------------------------------------------
-- The obvious way to check the index is to re-derive it — which would be a THIRD
-- implementation of the URL extraction rules, after `assets.ts` and the SQL in
-- 0037. Three implementations means three things that can disagree, and a
-- checker that disagrees with the thing it checks is worse than no checker.
--
-- So this does not re-derive anything. It snapshots the index, RE-FIRES THE REAL
-- TRIGGERS by assigning each content column to itself, diffs the result against
-- the snapshot, and rolls the whole thing back. Whatever the triggers would
-- produce today is compared against what they actually produced when the rows
-- were last written. Same trick as 0037's backfill and `blob-drift --repair`.
--
-- SAFE TO RUN IN PRODUCTION. Everything happens inside one transaction that ends
-- in ROLLBACK, so no row is changed and no `updated_at` moves — the UPDATEs take
-- brief row locks and are undone. At this data size (~1.1k content rows) it is
-- milliseconds. It is NOT free at arbitrary scale: it touches every content row,
-- so revisit before running it against a much larger database.
--
-- Run as the MIGRATOR (`MIGRATE_DATABASE_URL` / `neondb_owner`). The app role has
-- only SELECT on `blob_references`, which is enough to read but the UPDATEs need
-- ordinary write access to the content tables.
--
--     psql "$MIGRATE_DATABASE_URL" -f docs/sql/blob-drift-check.sql
--
-- EXPECTED OUTPUT: zero rows. Any row is a trigger that did not fire.
--
--   missing      the re-fired trigger produced a reference the index lacks. THE
--                SERIOUS ONE — a deployment reading only the index would treat
--                that file as an orphan and delete it. `del()` has no undo.
--   stale_extra  the index holds a reference the trigger no longer produces. The
--                source changed without the trigger firing. Costs a refused
--                delete (leaked bytes), never data.
--   orphaned     the index row's source row does not exist at all. Same cost as
--                stale_extra. Detected separately because a source that is gone
--                can never re-fire a trigger to correct itself.
--
-- KEEP IN STEP: the six UPDATEs and the six branches of `live_sources` must match
-- the triggers 0037 installs. Adding a content surface means editing this file
-- too — that obligation is on `docs/adding-an-app.md`.

BEGIN;

CREATE TEMP TABLE blob_refs_before AS
  SELECT app, source_type, source_id, url FROM platform.blob_references;

-- Re-fire every trigger. `UPDATE OF col` fires on the column being ASSIGNED,
-- not on the value changing, so these rebuild the index without altering data.
UPDATE issues.issues          SET description = description WHERE description IS NOT NULL;
UPDATE issues.tasks           SET description = description WHERE description IS NOT NULL;
UPDATE issues.projects        SET summary = summary, description = description
                              WHERE summary IS NOT NULL OR description IS NOT NULL;
UPDATE issues.project_updates SET body = body WHERE body IS NOT NULL;
UPDATE issues.attachments     SET file_url = file_url WHERE file_url IS NOT NULL;
UPDATE platform.comments      SET content = content WHERE content IS NOT NULL;

WITH after AS (
  SELECT app, source_type, source_id, url FROM platform.blob_references
),
-- Does the referencing row still exist? Only the table mapping is repeated here,
-- never the extraction rules.
live_sources AS (
  SELECT 'issues'::text AS app, 'issue'::text AS source_type, id::bigint AS source_id FROM issues.issues
  UNION ALL SELECT 'issues', 'task',           id::bigint FROM issues.tasks
  UNION ALL SELECT 'issues', 'project',        id::bigint FROM issues.projects
  UNION ALL SELECT 'issues', 'project_update', id::bigint FROM issues.project_updates
  UNION ALL SELECT 'issues', 'attachment',     id::bigint FROM issues.attachments
  UNION ALL SELECT 'platform', 'comment',      id::bigint FROM platform.comments
),
diff AS (
  -- The trigger now produces a reference the index did not have.
  SELECT a.app, a.source_type, a.source_id, a.url, 'missing' AS kind
    FROM after a
    LEFT JOIN blob_refs_before b USING (app, source_type, source_id, url)
   WHERE b.url IS NULL
  UNION ALL
  -- The index held a reference the trigger no longer produces, for a source that
  -- still exists.
  SELECT b.app, b.source_type, b.source_id, b.url, 'stale_extra'
    FROM blob_refs_before b
    LEFT JOIN after a USING (app, source_type, source_id, url)
   WHERE a.url IS NULL
     AND EXISTS (SELECT 1 FROM live_sources s
                  WHERE s.app = b.app AND s.source_type = b.source_type
                    AND s.source_id = b.source_id)
  UNION ALL
  -- An orphan CANNOT be found by diffing, and assuming otherwise was a bug in
  -- this file caught by injecting one: a row whose source is gone never re-fires
  -- a trigger, so it is byte-identical before and after and falls out of both
  -- branches above. It has to be looked for directly.
  SELECT a.app, a.source_type, a.source_id, a.url, 'orphaned'
    FROM after a
   WHERE NOT EXISTS (SELECT 1 FROM live_sources s
                      WHERE s.app = a.app AND s.source_type = a.source_type
                        AND s.source_id = a.source_id)
)
SELECT kind, app, source_type, source_id, url FROM diff
-- `missing` first: it is the only kind that can end in a deleted file.
ORDER BY (kind <> 'missing'), app, source_type, source_id, url;

-- Rows the workspace-scoped reconciler could never reach. NOT drift — rows
-- nobody looked at, which is a different and more dangerous kind of silence.
-- Every `attachment` row was in this state before 0037 backfilled
-- `issues.attachments.workspace_id`. Expect 0.
SELECT count(*) AS unreconcilable_rows
  FROM platform.blob_references r
 WHERE r.app IN ('issues', 'platform')
   AND (r.workspace_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM platform.workspaces w WHERE w.id = r.workspace_id));

ROLLBACK;
