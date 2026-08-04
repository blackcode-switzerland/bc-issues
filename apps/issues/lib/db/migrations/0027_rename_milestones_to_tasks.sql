-- Migration 0027: Rename "milestones" to "tasks" everywhere in the schema.
-- Pure rename — functionality is unchanged. Covers the table, the issues
-- foreign-key column, indexes, the polymorphic CHECK values, and historical
-- event / comment / deletion-batch / undo data so nothing still says "milestone".

-- 1. Table + its indexes
ALTER TABLE milestones RENAME TO tasks;
ALTER INDEX IF EXISTS idx_milestones_project RENAME TO idx_tasks_project;
ALTER INDEX IF EXISTS idx_milestones_deleted RENAME TO idx_tasks_deleted;
ALTER INDEX IF EXISTS idx_milestones_batch   RENAME TO idx_tasks_batch;

-- 2. issues.milestone_id -> issues.task_id (+ its index)
ALTER TABLE issues RENAME COLUMN milestone_id TO task_id;
ALTER INDEX IF EXISTS idx_issues_milestone RENAME TO idx_issues_task;

-- 3. comments.parent_type: replace 'milestone' with 'task' (rewrite the CHECK,
--    matched name-agnostically in case the original constraint name differs).
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'comments'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%parent_type%'
  LOOP
    EXECUTE format('ALTER TABLE comments DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
UPDATE comments SET parent_type = 'task' WHERE parent_type = 'milestone';
ALTER TABLE comments ADD CONSTRAINT comments_parent_type_check
  CHECK (parent_type IS NULL OR parent_type IN ('issue', 'task', 'project'));

-- 4. deletion_batches.root_type: replace 'milestone' with 'task'.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'deletion_batches'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%root_type%'
  LOOP
    EXECUTE format('ALTER TABLE deletion_batches DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
UPDATE deletion_batches SET root_type = 'task' WHERE root_type = 'milestone';
ALTER TABLE deletion_batches ADD CONSTRAINT deletion_batches_root_type_check
  CHECK (root_type IN ('project', 'task', 'issue'));

-- 5. Historical event + undo data (entity_type/action are free-text varchars).
UPDATE events SET entity_type = 'task' WHERE entity_type = 'milestone';
UPDATE events SET action = 'task_changed' WHERE action = 'milestone_changed';
UPDATE transaction_log SET table_name = 'tasks' WHERE table_name = 'milestones';
