-- Migration 0025: Replace single assignee_id on issues with issue_assignees junction table.
-- This enables assigning multiple users to a single issue.

-- 1. Create the new junction table.
CREATE TABLE IF NOT EXISTS issue_assignees (
  issue_id   INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (issue_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_issue_assignees_issue ON issue_assignees(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_assignees_user  ON issue_assignees(user_id);

-- 2. Backfill from the existing single-assignee column.
INSERT INTO issue_assignees (issue_id, user_id)
SELECT id, assignee_id
FROM issues
WHERE assignee_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 3. Drop the old column (also drops idx_issues_assignee index automatically).
ALTER TABLE issues DROP COLUMN IF EXISTS assignee_id;
