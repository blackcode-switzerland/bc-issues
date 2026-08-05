-- Phase 8: `platform.blob_references` — the cross-deployment reference index.
--
-- This closes the blocker Phase 7 left behind ("OWED BEFORE APP #2" in
-- PLATFORM-MIGRATION-PLAN.md). Read the header of
-- `packages/platform-db/src/schema.ts` at `blobReferences` for WHY; this file is
-- HOW.
--
-- ADDITIVE, ENTIRELY. One new table, one new column with a default, three
-- functions and six triggers. No column is dropped, renamed or tightened, and
-- nothing the currently-deployed code reads or writes changes shape. The
-- triggers maintain the index for the OLD code as happily as for the new, which
-- is what lets this be applied before the deploy with no window in which the
-- database is wrong.
--
-- ---------------------------------------------------------------------------
-- THE ONE THING THAT CAN GO WRONG HERE
-- ---------------------------------------------------------------------------
-- A trigger that raises breaks the write it is attached to. These six sit on
-- `issues.issues`, `issues.tasks`, `issues.projects`, `issues.project_updates`,
-- `issues.attachments` and `platform.comments` — i.e. on almost every write the
-- product makes. An error in `platform.blob_refs_sync()` is therefore an
-- immediate, total outage of content editing, not a degraded reference count.
--
-- That is the cost of the guarantee. The benefit is that no write path can
-- forget the index, which is the only failure mode that ends in deleting a file
-- somebody is still using. Rehearse on a Neon branch and exercise a real write
-- of every triggered table before this goes near main.
--
-- ---------------------------------------------------------------------------
-- WHY THE BACKFILL IS A NO-OP UPDATE
-- ---------------------------------------------------------------------------
-- `UPDATE ... SET description = description` fires the trigger (an `UPDATE OF`
-- trigger fires on the column being ASSIGNED, not on the value changing), so the
-- backfill is executed by the exact code that will maintain the index from here
-- on. Re-deriving it with a hand-written INSERT ... SELECT would be a second
-- implementation of the extraction rules, and a second implementation is a
-- second thing that can disagree. The same trick is how
-- `bk super-admin blob-drift --repair` repairs a row.
--
-- Re-runnable: every CREATE is OR REPLACE / IF NOT EXISTS, the trigger drops
-- precede the creates, and re-running the backfill converges on the same rows.
-- Rollback is docs/sql/phase8-blob-references-rollback.sql.

CREATE TABLE IF NOT EXISTS "platform"."blob_references" (
	"url" text NOT NULL,
	"app" varchar(40) NOT NULL,
	"source_type" varchar(40) NOT NULL,
	"source_id" bigint NOT NULL,
	"workspace_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blob_references_app_source_type_source_id_url_pk" PRIMARY KEY("app","source_type","source_id","url")
);
--> statement-breakpoint
ALTER TABLE "platform"."apps" ADD COLUMN IF NOT EXISTS "maintains_blob_index" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_blob_references_url_app" ON "platform"."blob_references" USING btree ("url","app");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_blob_references_workspace" ON "platform"."blob_references" USING btree ("workspace_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- THE RECOGNIZER, IN SQL
-- ---------------------------------------------------------------------------
-- These three functions are a second implementation of
-- `packages/platform-storage/src/assets.ts`, and that duplication is the price
-- of maintaining the index in the database. It is NOT left to drift:
-- `lib/storage/sql-parity.integration.test.ts` feeds one corpus through both and
-- fails if they disagree on a single string. Change one, change the other, and
-- let that test decide whether you got it right.

-- The authority component of a URL, lowercased — `new URL(u).hostname` in SQL.
CREATE OR REPLACE FUNCTION platform.blob_url_host(u text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT lower(
    regexp_replace(                                    -- 4. drop :port
      regexp_replace(                                  -- 3. drop user:pass@
        regexp_replace(                                -- 2. keep the authority
          regexp_replace(u, '^[A-Za-z][A-Za-z0-9+.-]*://', ''),  -- 1. drop scheme
          '[/?#].*$', ''),
        '^.*@', ''),
      ':[0-9]*$', '')
  )
$fn$;--> statement-breakpoint

-- True only for URLs that came out of OUR upload pipeline. Mirrors
-- `isUploadedAsset`.
CREATE OR REPLACE FUNCTION platform.is_uploaded_asset(u text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT CASE
    WHEN u IS NULL OR u = '' THEN false
    WHEN u LIKE '/uploads/%' THEN true
    WHEN u ~* '^https?://' THEN
      platform.blob_url_host(u) = 'blob.vercel-storage.com'
      OR platform.blob_url_host(u) LIKE '%.blob.vercel-storage.com'
    ELSE false
  END
$fn$;--> statement-breakpoint

-- Every distinct our-origin upload URL in a body of text/HTML. Mirrors
-- `extractUploadedUrls`, including the trailing-prose-punctuation trim.
CREATE OR REPLACE FUNCTION platform.extract_uploaded_urls(content text) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT coalesce(array_agg(DISTINCT u), ARRAY[]::text[])
  FROM (
    SELECT regexp_replace(m[1], '[.,;:!?]+$', '') AS u
    FROM regexp_matches(
           coalesce(content, ''),
           '(https?://[^[:space:]"''<>()\[\]]+|/uploads/[^[:space:]"''<>()\[\]]+)',
           'gi') AS m
  ) s
  WHERE platform.is_uploaded_asset(u)
$fn$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- THE TRIGGER
-- ---------------------------------------------------------------------------
-- One generic function for all six tables, parameterised through TG_ARGV:
--
--   TG_ARGV[0]  app slug to attribute the reference to
--   TG_ARGV[1]  source_type, in the app's own vocabulary
--   TG_ARGV[2]  name of the workspace-id column on this table
--   TG_ARGV[3]  'scan' (extract URLs from prose) | 'exact' (the column IS a URL)
--   TG_ARGV[4…] the content column(s)
--
-- SECURITY DEFINER, owned by the migrator: app roles hold SELECT on
-- `blob_references` and nothing more, so the trigger is the only writer and an
-- app cannot forge or erase another app's references. `search_path` is pinned
-- because a SECURITY DEFINER function that resolves names through the caller's
-- search_path is a privilege-escalation hole.
--
-- The row is addressed by (app, source_type, source_id) and its whole reference
-- set is REPLACED on every fire — never incrementally patched. Replacement is
-- idempotent, so a re-run, a repair and the backfill all converge; an
-- incremental patch would have to be right every single time.
CREATE OR REPLACE FUNCTION platform.blob_refs_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, platform AS $fn$
DECLARE
  v_app   text := TG_ARGV[0];
  v_type  text := TG_ARGV[1];
  v_wscol text := TG_ARGV[2];
  v_mode  text := TG_ARGV[3];
  v_row   jsonb;
  v_id    bigint;
  v_ws    integer;
  v_urls  text[] := ARRAY[]::text[];
  v_val   text;
  i       int;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := to_jsonb(OLD); ELSE v_row := to_jsonb(NEW); END IF;
  v_id := (v_row ->> 'id')::bigint;
  v_ws := nullif(v_row ->> v_wscol, '')::integer;

  -- A DELETE leaves v_urls empty, so the DELETE below removes every row for
  -- this source. That is the whole handling of a hard delete.
  IF TG_OP <> 'DELETE' THEN
    FOR i IN 4 .. coalesce(array_length(TG_ARGV, 1), 0) - 1 LOOP
      v_val := v_row ->> TG_ARGV[i];
      IF v_mode = 'exact' THEN
        IF v_val IS NOT NULL AND platform.is_uploaded_asset(v_val) THEN
          v_urls := v_urls || v_val;
        END IF;
      ELSE
        v_urls := v_urls || platform.extract_uploaded_urls(v_val);
      END IF;
    END LOOP;
  END IF;

  DELETE FROM platform.blob_references
   WHERE app = v_app AND source_type = v_type AND source_id = v_id
     AND NOT (url = ANY (v_urls));

  IF coalesce(array_length(v_urls, 1), 0) > 0 THEN
    INSERT INTO platform.blob_references (url, app, source_type, source_id, workspace_id)
    SELECT DISTINCT u, v_app, v_type, v_id, v_ws FROM unnest(v_urls) AS u
    ON CONFLICT (app, source_type, source_id, url)
      DO UPDATE SET workspace_id = EXCLUDED.workspace_id;
  END IF;

  RETURN NULL;
END
$fn$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- THE ONE SANCTIONED DELETE
-- ---------------------------------------------------------------------------
-- `bk super-admin blob-drift --repair` fixes a MISSING row by re-triggering the
-- source (`UPDATE t SET col = col WHERE id = …`), which needs no new privilege.
-- An ORPHANED row — an index entry whose source row is gone — has no source left
-- to re-trigger, and app roles hold SELECT only, so repairing one needs this.
--
-- It is deliberately not a general DELETE grant. The caller must name the exact
-- (app, source_type, source_id) it has just proven is gone, and may only name
-- its own app or `'platform'`. The threat model here is a BUG, not an attacker:
-- what must be impossible is an ordinary write path silently dropping a
-- reference. An explicitly-invoked, super-admin-gated repair that reports every
-- row it removed is not an ordinary write path.
CREATE OR REPLACE FUNCTION platform.blob_refs_purge(p_app text, p_type text, p_id bigint)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, platform AS $fn$
DECLARE
  n integer;
  is_owner boolean := pg_catalog.pg_has_role(
    current_user,
    (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'platform.blob_references'::regclass),
    'USAGE');
  is_own_app boolean := current_user = p_app || '_app';
  -- `'platform'` rows (comments) belong to no single app, so any app role may
  -- repair one. They are also the rows every scanner already covers.
  is_shared boolean := p_app = 'platform'
    AND EXISTS (SELECT 1 FROM platform.apps a WHERE current_user = a.slug || '_app');
BEGIN
  IF NOT (is_owner OR is_own_app OR is_shared) THEN
    RAISE EXCEPTION 'blob_refs_purge: role % may not purge references held by app %', current_user, p_app;
  END IF;
  DELETE FROM platform.blob_references
   WHERE app = p_app AND source_type = p_type AND source_id = p_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- THE SIX CONTENT SURFACES
-- ---------------------------------------------------------------------------
-- Exactly the surfaces `apps/issues/lib/storage/scanner.ts` scans. `UPDATE OF`
-- keeps the trigger off the many writes that touch other columns (status,
-- assignee, deleted_at, …). A soft delete does NOT drop the index rows,
-- deliberately: a binned item is restorable, so its files are still in use —
-- the same rule the scanner has always applied.
--
-- `platform.comments` is attributed to `'platform'`, not to `issues`: it is a
-- platform-owned table that every app writes into, so its references belong to
-- no single app. The delete gate always consults `'platform'`.

DROP TRIGGER IF EXISTS trg_blob_refs ON issues.issues;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs AFTER INSERT OR DELETE OR UPDATE OF description ON issues.issues
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync('issues', 'issue', 'workspace_id', 'scan', 'description');--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_blob_refs ON issues.tasks;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs AFTER INSERT OR DELETE OR UPDATE OF description ON issues.tasks
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync('issues', 'task', 'workspace_id', 'scan', 'description');--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_blob_refs ON issues.projects;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs AFTER INSERT OR DELETE OR UPDATE OF summary, description ON issues.projects
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync('issues', 'project', 'workspace_id', 'scan', 'summary', 'description');--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_blob_refs ON issues.project_updates;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs AFTER INSERT OR DELETE OR UPDATE OF body ON issues.project_updates
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync('issues', 'project_update', 'workspace_id', 'scan', 'body');--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_blob_refs ON issues.attachments;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs AFTER INSERT OR DELETE OR UPDATE OF file_url ON issues.attachments
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync('issues', 'attachment', 'workspace_id', 'exact', 'file_url');--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_blob_refs ON platform.comments;--> statement-breakpoint
CREATE TRIGGER trg_blob_refs AFTER INSERT OR DELETE OR UPDATE OF content ON platform.comments
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync('platform', 'comment', 'workspace_id', 'scan', 'content');--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- GRANTS — app roles read the index, and may not write it
-- ---------------------------------------------------------------------------
-- `docs/sql/app-role.sql` runs ALTER DEFAULT PRIVILEGES granting full DML on
-- future tables in `platform`, so without this the app role would arrive with
-- INSERT/UPDATE/DELETE on the index and could erase a rival app's references —
-- the one direction of drift that ends in lost bytes. Revoke it back to SELECT.
--
-- Roles are derived from `platform.apps` (`<slug>_app`, the convention in
-- app-role.sql) and skipped when they do not exist, so this is a no-op on a
-- local or test database where the app connects as the owner.
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT a.slug || '_app' AS role_name
    FROM platform.apps a
    WHERE EXISTS (SELECT 1 FROM pg_roles p WHERE p.rolname = a.slug || '_app')
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform.blob_references FROM %I', r.role_name);
    EXECUTE format('GRANT SELECT ON platform.blob_references TO %I', r.role_name);
  END LOOP;
END
$do$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- FIRST, A DATA REPAIR THE INDEX DEPENDS ON
-- ---------------------------------------------------------------------------
-- `issues.attachments.workspace_id` has been NULL on every row since the column
-- was added — it is nullable "during backfill" (schema.ts) and the backfill never
-- happened. It went unnoticed because the delete gate does not use it: the
-- scanner's `isUrlReferenced` matches on `file_url` alone.
--
-- The index makes it matter. `blob_references.workspace_id` comes from the source
-- row, the Storage page lists references BY workspace, and the reconciler
-- compares them one workspace at a time — so 24 attachment references would have
-- been invisible to all three while looking, from the outside, like a clean
-- report. That is exactly the kind of quiet hole this phase exists to close, and
-- it is why the reconciler now also counts rows no workspace pass can reach.
--
-- Every attachment has a NOT NULL `issue_id`, and every issue in this database
-- has a workspace, so the value is fully recoverable. Guarded by IS NULL, so it
-- is re-runnable and cannot overwrite a real value.
UPDATE issues.attachments a
   SET workspace_id = i.workspace_id
  FROM issues.issues i
 WHERE a.issue_id = i.id
   AND a.workspace_id IS NULL
   AND i.workspace_id IS NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- BACKFILL — by re-triggering, so it cannot disagree with the trigger
-- ---------------------------------------------------------------------------
UPDATE issues.issues          SET description = description WHERE description IS NOT NULL;--> statement-breakpoint
UPDATE issues.tasks           SET description = description WHERE description IS NOT NULL;--> statement-breakpoint
UPDATE issues.projects        SET summary = summary, description = description WHERE summary IS NOT NULL OR description IS NOT NULL;--> statement-breakpoint
UPDATE issues.project_updates SET body = body WHERE body IS NOT NULL;--> statement-breakpoint
UPDATE issues.attachments     SET file_url = file_url WHERE file_url IS NOT NULL;--> statement-breakpoint
UPDATE platform.comments      SET content = content WHERE content IS NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- DECLARE COVERAGE — last, so it is only true once the index is actually built
-- ---------------------------------------------------------------------------
-- This flag is what lets ANOTHER deployment skip asking the issues deployment
-- whether it references a file. Setting it before the backfill would advertise
-- an empty index as authoritative, which is exactly how a file in use gets
-- deleted. It goes at the bottom of the file for that reason.
UPDATE platform.apps SET maintains_blob_index = true WHERE slug = 'issues';
