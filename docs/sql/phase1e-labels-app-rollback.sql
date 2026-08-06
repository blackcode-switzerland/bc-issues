-- Phase 1e-3 rollback — drop `platform.labels.app` (0043).
--
-- READ THIS FIRST: you almost certainly do not need it, and the code rollback is
-- free. 0043 adds one nullable column, one FK and one index. A build from before
-- it never selects the column and never writes it, so **promoting the previous
-- deployment is a complete rollback of the behaviour** — every label becomes
-- visible to every app again, which is exactly what the old code did.
--
-- Running the DDL below is only for undoing the migration itself.
--
-- ---------------------------------------------------------------------------
-- WHAT DROPPING THE COLUMN COSTS
-- ---------------------------------------------------------------------------
-- The scoping information. `app` is the ONLY record of which app a label belongs
-- to; nothing else in the schema carries it. Dropping the column and re-adding
-- it later gives you a table where every row is shared again, and the labels a
-- second app created are indistinguishable from this app's. Re-running 0043 does
-- NOT recover it — there is no backfill to re-derive it from.
--
-- So look before you drop:
--
--     SELECT coalesce(app, '(shared)') AS scope, count(*)
--     FROM platform.labels GROUP BY 1 ORDER BY 1;
--
-- If any row has a non-null `app`, capture the mapping first:
--
--     \copy (SELECT id, workspace_id, name, app FROM platform.labels
--            WHERE app IS NOT NULL) TO 'labels-app.csv' CSV HEADER
--
-- Run as the schema owner (neondb_owner).

-- The index and FK go with the column, but dropping them explicitly keeps the
-- statement list readable against `\d platform.labels` afterwards.
DROP INDEX IF EXISTS platform.idx_labels_workspace_app;--> statement-breakpoint
ALTER TABLE platform.labels DROP CONSTRAINT IF EXISTS labels_app_apps_slug_fk;--> statement-breakpoint
ALTER TABLE platform.labels DROP COLUMN IF EXISTS app;

-- Verify (expect: no `app` column, and `idx_labels_workspace` still present).
\d platform.labels
