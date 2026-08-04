-- Migration 0028: Rename projects.end_date → due_date.
-- The project "target date" is now a due date, consistent with issues and tasks.
-- Pure column rename; data preserved.

ALTER TABLE projects RENAME COLUMN end_date TO due_date;
