-- Migration 0029: Add tasks.lead_id (task lead).
-- Mirrors projects.owner_id — the person accountable for the task.
-- ON DELETE SET NULL so removing the user just clears the lead.

ALTER TABLE tasks ADD COLUMN lead_id integer REFERENCES users(id) ON DELETE SET NULL;
