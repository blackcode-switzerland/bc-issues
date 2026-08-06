-- Phase 1e-1 rollback — `platform.comments.parent_type` back to bare nouns (0041).
--
-- READ THIS FIRST: promoting the previous deployment is NOT enough here, and
-- that is the difference from most rollbacks in this directory.
--
-- 0041 did two things. Widening the CHECK is inert to old code — it only ever
-- accepts more. The BACKFILL is not: the previous build matches
-- `parent_type = 'issue'` exactly, so with the rows rewritten to `'issues:issue'`
-- it renders every comment thread empty. Nothing is lost and nothing is
-- corrupted, but the product looks broken.
--
-- So the decision tree is:
--
--   rolling back the CODE only, and quickly   → run STEP 1 of this file.
--                                               Leave the widened CHECK alone.
--   undoing the migration entirely            → run STEP 1, then STEP 2.
--   rolling FORWARD (the usual answer)        → run nothing. Promote the fixed
--                                               build; it reads both forms.
--
-- STEP 2 is the one to think twice about. It re-narrows the CHECK to three of
-- ONE app's nouns, so any other app that has written a comment since is now
-- holding rows the constraint refuses — `ALTER TABLE … ADD CONSTRAINT` validates
-- existing rows and will fail, loudly, which is the correct outcome. Check
-- before you run it:
--
--     SELECT split_part(parent_type, ':', 1) AS app, count(*)
--     FROM platform.comments WHERE parent_type LIKE '%:%'
--     GROUP BY 1 ORDER BY 1;
--
-- If that returns any app other than `issues`, STOP. Rolling back this column
-- means deleting or rewriting that app's comments, which is a data decision, not
-- a deploy step.
--
-- Run as the schema owner (neondb_owner). The app role has no DDL.

-- ---------------------------------------------------------------------------
-- STEP 1 — un-qualify this app's rows. Idempotent; safe to re-run.
-- ---------------------------------------------------------------------------
UPDATE platform.comments
   SET parent_type = substr(parent_type, length('issues:') + 1)
 WHERE parent_type IN ('issues:issue', 'issues:task', 'issues:project');

-- ---------------------------------------------------------------------------
-- STEP 2 — restore the pre-0041 constraint and width. OPTIONAL. Read the header.
-- ---------------------------------------------------------------------------
-- ALTER TABLE platform.comments DROP CONSTRAINT comments_parent_type_check;
-- ALTER TABLE platform.comments ALTER COLUMN parent_type TYPE varchar(20);
-- ALTER TABLE platform.comments ADD CONSTRAINT comments_parent_type_check
--   CHECK (parent_type IS NULL OR parent_type IN ('issue', 'task', 'project'));

-- Verify (expect: zero qualified rows left for this app).
SELECT parent_type, count(*) FROM platform.comments GROUP BY 1 ORDER BY 1;
