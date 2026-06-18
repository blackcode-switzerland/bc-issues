-- Migration 0026: Remove the workspace issue-key prefix.
-- Issues are now identified by their per-workspace sequence number alone
-- (displayed as #<seq>), so the workspaces.key column and its unique index
-- are no longer needed. This is irreversible — the key values are dropped.

DROP INDEX IF EXISTS uq_workspaces_key;

ALTER TABLE workspaces DROP COLUMN IF EXISTS key;
