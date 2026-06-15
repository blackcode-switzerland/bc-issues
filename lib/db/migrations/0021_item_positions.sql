-- Add manual ordering position to projects and issues.
-- NULL = new/unpositioned item, sorts to the top via COALESCE(position, 0) ASC.
-- Explicit positions start at 1 and are set by the reorder endpoints.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS position INTEGER;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS position INTEGER;
