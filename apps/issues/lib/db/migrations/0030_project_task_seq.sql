-- Migration 0030: Per-workspace human numbers (seq) for projects and tasks.
--
-- Issues already have a workspace-scoped `seq` (the #N shown in the UI/URL).
-- This brings projects and tasks to parity so every work item has one stable,
-- workspace-scoped, user-facing number — and the global serial `id` becomes a
-- backend-only primary key. Purely additive + backfill; no data is lost.

-- 1. New nullable columns (tightened by the unique index once backfilled).
ALTER TABLE projects ADD COLUMN seq integer;
ALTER TABLE tasks ADD COLUMN seq integer;

-- 2. Per-type counters on the existing per-workspace counters row.
ALTER TABLE workspace_counters ADD COLUMN last_project_seq integer NOT NULL DEFAULT 0;
ALTER TABLE workspace_counters ADD COLUMN last_task_seq integer NOT NULL DEFAULT 0;

-- 3. Backfill seq per workspace in creation order (oldest = #1). Includes
--    soft-deleted rows so a restore keeps its original number.
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY workspace_id ORDER BY id) AS rn
  FROM projects
)
UPDATE projects p SET seq = n.rn FROM numbered n WHERE p.id = n.id;

WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY workspace_id ORDER BY id) AS rn
  FROM tasks
)
UPDATE tasks t SET seq = n.rn FROM numbered n WHERE t.id = n.id;

-- 4. Seed the counters to each workspace's current max so new rows continue.
UPDATE workspace_counters c
SET last_project_seq = COALESCE(
  (SELECT max(seq) FROM projects p WHERE p.workspace_id = c.workspace_id), 0);
UPDATE workspace_counters c
SET last_task_seq = COALESCE(
  (SELECT max(seq) FROM tasks t WHERE t.workspace_id = c.workspace_id), 0);

-- 5. Enforce uniqueness per workspace (matches uq_issues_workspace_seq).
CREATE UNIQUE INDEX uq_projects_workspace_seq ON projects (workspace_id, seq);
CREATE UNIQUE INDEX uq_tasks_workspace_seq ON tasks (workspace_id, seq);
