-- Recycle bin: soft-delete + restore + manual purge for issues, projects, milestones.
--
-- Deletes become soft (deleted_at stamped, row kept and hidden from active
-- views). A deletion_batch groups one delete operation and records its mode
-- (cascade = children binned together; detach = children kept active), which
-- drives batch-aware restore. Keeping the row intact means FK columns
-- (project_id / milestone_id) survive, so cascade-deleted children re-link to
-- their parent automatically on restore and issue seq never collides.

CREATE TABLE IF NOT EXISTS deletion_batches (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  mode varchar(10) NOT NULL,
  root_type varchar(20) NOT NULL,
  root_id integer NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT deletion_batches_mode_check CHECK (mode IN ('cascade', 'detach')),
  CONSTRAINT deletion_batches_root_type_check CHECK (root_type IN ('project', 'milestone', 'issue'))
);

CREATE INDEX IF NOT EXISTS idx_deletion_batches_ws ON deletion_batches(workspace_id, created_at);

-- Soft-delete columns. deleted_at IS NULL => active.
ALTER TABLE issues ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS deleted_by integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS delete_batch_id integer REFERENCES deletion_batches(id) ON DELETE SET NULL;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_by integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS delete_batch_id integer REFERENCES deletion_batches(id) ON DELETE SET NULL;

ALTER TABLE milestones ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS deleted_by integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS delete_batch_id integer REFERENCES deletion_batches(id) ON DELETE SET NULL;

-- Partial indexes for the Trash listing (only binned rows) and batch restore.
CREATE INDEX IF NOT EXISTS idx_issues_deleted ON issues(workspace_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_deleted ON projects(workspace_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_milestones_deleted ON milestones(workspace_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_issues_batch ON issues(delete_batch_id);
CREATE INDEX IF NOT EXISTS idx_projects_batch ON projects(delete_batch_id);
CREATE INDEX IF NOT EXISTS idx_milestones_batch ON milestones(delete_batch_id);
