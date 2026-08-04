-- Phase 1 backfill: every existing user gets a Personal workspace and every
-- domain row inherits a workspace_id. This migration is data-only — it does
-- not alter columns or constraints. Run AFTER 0003_workspaces_init.sql.
--
-- Backfill rule (intentionally simple for v1):
--   - One workspace per user (key = 'WS' || user.id, slug = '<email-local>-<id>').
--   - Every project rooted at its owner's personal workspace.
--   - Every milestone/issue inherits from its project.
--   - Every comment/attachment inherits from its issue's project.
--   - Every label inherits from its project.
--
-- Projects with NULL owner_id (FK is ON DELETE SET NULL) are left with
-- workspace_id NULL; same for any row that fails to derive one. The Phase 13
-- NOT NULL tightening will flag any remaining orphans for manual fixup.

-- ---------------------------------------------------------------------------
-- 1) Personal workspaces — one per user
-- ---------------------------------------------------------------------------
INSERT INTO workspaces (name, slug, key, owner_id, created_at, updated_at)
SELECT
  COALESCE(NULLIF(u.name, ''), split_part(u.email, '@', 1)) || '''s workspace',
  regexp_replace(lower(split_part(u.email, '@', 1)), '[^a-z0-9-]+', '-', 'g') || '-' || u.id::text,
  'WS' || u.id::text,
  u.id,
  COALESCE(u.created_at, now()),
  COALESCE(u.updated_at, now())
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.owner_id = u.id);

-- ---------------------------------------------------------------------------
-- 2) Workspace memberships — owners
-- ---------------------------------------------------------------------------
INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
SELECT w.id, w.owner_id, 'owner', w.created_at
FROM workspaces w
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3) users.active_workspace_id default = owner's personal workspace
-- ---------------------------------------------------------------------------
UPDATE users u
SET active_workspace_id = w.id
FROM workspaces w
WHERE w.owner_id = u.id
  AND u.active_workspace_id IS NULL;

-- ---------------------------------------------------------------------------
-- 4) projects.workspace_id  — from owner's personal workspace
-- ---------------------------------------------------------------------------
UPDATE projects p
SET workspace_id = w.id
FROM workspaces w
WHERE w.owner_id = p.owner_id
  AND p.workspace_id IS NULL;

-- ---------------------------------------------------------------------------
-- 5) milestones.workspace_id  — inherit from project
-- ---------------------------------------------------------------------------
UPDATE milestones m
SET workspace_id = p.workspace_id
FROM projects p
WHERE p.id = m.project_id
  AND m.workspace_id IS NULL
  AND p.workspace_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6) issues.workspace_id  — inherit from project
-- ---------------------------------------------------------------------------
UPDATE issues i
SET workspace_id = p.workspace_id
FROM projects p
WHERE p.id = i.project_id
  AND i.workspace_id IS NULL
  AND p.workspace_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7) comments.workspace_id + polymorphic parent fields
-- ---------------------------------------------------------------------------
UPDATE comments c
SET workspace_id = i.workspace_id
FROM issues i
WHERE i.id = c.issue_id
  AND c.workspace_id IS NULL
  AND i.workspace_id IS NOT NULL;

UPDATE comments
SET parent_type = 'issue',
    parent_id = issue_id
WHERE parent_type IS NULL;

-- ---------------------------------------------------------------------------
-- 8) attachments.workspace_id  — inherit from issue
-- ---------------------------------------------------------------------------
UPDATE attachments a
SET workspace_id = i.workspace_id
FROM issues i
WHERE i.id = a.issue_id
  AND a.workspace_id IS NULL
  AND i.workspace_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 9) labels.workspace_id  — inherit from project
-- ---------------------------------------------------------------------------
UPDATE labels l
SET workspace_id = p.workspace_id
FROM projects p
WHERE p.id = l.project_id
  AND l.workspace_id IS NULL
  AND p.workspace_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 10) Allocate issues.seq within each workspace, oldest first
-- ---------------------------------------------------------------------------
WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY workspace_id
      ORDER BY COALESCE(created_at, now()), id
    ) AS new_seq
  FROM issues
  WHERE workspace_id IS NOT NULL
    AND seq IS NULL
)
UPDATE issues i
SET seq = numbered.new_seq
FROM numbered
WHERE i.id = numbered.id;

-- ---------------------------------------------------------------------------
-- 11) workspace_counters seeded with current max(seq) per workspace
-- ---------------------------------------------------------------------------
INSERT INTO workspace_counters (workspace_id, last_issue_seq)
SELECT w.id, COALESCE(MAX(i.seq), 0)
FROM workspaces w
LEFT JOIN issues i ON i.workspace_id = w.id
GROUP BY w.id
ON CONFLICT (workspace_id) DO UPDATE
  SET last_issue_seq = EXCLUDED.last_issue_seq;
