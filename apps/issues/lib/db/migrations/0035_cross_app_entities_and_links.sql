-- Phase 6: cross-app primitives — URNs, the entity projection, and typed links.
--
--   platform.entities  — one row per addressable thing in any app, keyed by URN
--                        (bc:<app>:<workspace-slug>/<entity-type>/<number>). A
--                        PROJECTION: issues.issues is still the truth.
--   platform.links     — typed relations between two URNs, in any two apps.
--   platform.events    + app, + subject_urn — the per-workspace log becomes a
--                        cross-app one.
--
-- ADDITIVE, ENTIRELY. Two CREATE TABLEs, two nullable ADD COLUMNs, indexes and
-- foreign keys. Nothing is dropped, renamed or tightened, which is what lets this
-- be applied BEFORE the deploy that uses it — the cutover pattern in
-- PLATFORM-MIGRATION-PLAN.md — with no window in which the running code is wrong.
--
-- WHY events.app IS NULLABLE. Because of that same ordering: for the length of
-- the window between this migration and the promote, the OLD code is still
-- inserting events and does not know the column exists. NOT NULL would fail every
-- one of those inserts. DEFAULT 'issues' would hardcode one app's name into a
-- platform table, which is the coupling this whole migration exists to remove.
-- So: nullable, backfilled below, written by all current code, and tightened to
-- NOT NULL as a Phase 8 contract step once no deployed code can write a NULL.
-- That is expand → migrate → contract (PLATFORM-ARCHITECTURE.md §4.7).
--
-- THE BACKFILL IS IN THIS FILE ON PURPOSE. An empty `entities` is not a neutral
-- starting state: `bk search` would return nothing and `bk link create` would
-- reject every existing issue as an unknown URN, both of which read as "working,
-- nothing to show". DDL and backfill must never be applied apart.
--
-- Every statement is re-runnable: the INSERTs are ON CONFLICT DO NOTHING and the
-- UPDATEs are guarded by IS NULL. Rollback is docs/sql/phase6-rollback.sql.

CREATE TABLE "platform"."entities" (
	"urn" text PRIMARY KEY NOT NULL,
	"app" varchar(40) NOT NULL,
	"workspace_id" integer NOT NULL,
	"entity_type" varchar(40) NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platform"."links" (
	"from_urn" text NOT NULL,
	"to_urn" text NOT NULL,
	"rel" varchar(40) NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "links_from_urn_to_urn_rel_pk" PRIMARY KEY("from_urn","to_urn","rel"),
	CONSTRAINT "links_no_self_link" CHECK ("platform"."links"."from_urn" <> "platform"."links"."to_urn")
);
--> statement-breakpoint
ALTER TABLE "platform"."events" ADD COLUMN "app" varchar(40);--> statement-breakpoint
ALTER TABLE "platform"."events" ADD COLUMN "subject_urn" text;--> statement-breakpoint
ALTER TABLE "platform"."entities" ADD CONSTRAINT "entities_app_apps_slug_fk" FOREIGN KEY ("app") REFERENCES "platform"."apps"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."entities" ADD CONSTRAINT "entities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "platform"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."links" ADD CONSTRAINT "links_from_urn_entities_urn_fk" FOREIGN KEY ("from_urn") REFERENCES "platform"."entities"("urn") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "platform"."links" ADD CONSTRAINT "links_to_urn_entities_urn_fk" FOREIGN KEY ("to_urn") REFERENCES "platform"."entities"("urn") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "platform"."links" ADD CONSTRAINT "links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "platform"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_entities_natural" ON "platform"."entities" USING btree ("workspace_id","app","entity_type","number");--> statement-breakpoint
CREATE INDEX "idx_entities_ws_updated" ON "platform"."entities" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "idx_entities_ws_app" ON "platform"."entities" USING btree ("workspace_id","app","entity_type");--> statement-breakpoint
CREATE INDEX "idx_links_to" ON "platform"."links" USING btree ("to_urn");--> statement-breakpoint
ALTER TABLE "platform"."events" ADD CONSTRAINT "events_app_apps_slug_fk" FOREIGN KEY ("app") REFERENCES "platform"."apps"("slug") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_events_ws_app" ON "platform"."events" USING btree ("workspace_id","app","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_events_ws_subject" ON "platform"."events" USING btree ("workspace_id","subject_urn","occurred_at");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- BACKFILL
-- ---------------------------------------------------------------------------
-- One entities row per existing issue, task and project.
--
-- The predicate is the same one the reconciliation job uses, and it has to stay
-- that way or every run would report drift that is not drift: a source row is
-- projected when it has a workspace and a seq. Rows without a seq predate the
-- #number backfill and have no URN to be addressed by. Soft-deleted rows ARE
-- projected, with deleted_at mirrored — a link to something in the recycle bin
-- must survive being restored.
--
-- `url` is composed from the app's registered base_url; when that is NULL the
-- path is stored on its own and reconciliation repairs it once base_url is set.

INSERT INTO "platform"."entities"
  (urn, app, workspace_id, entity_type, number, title, url, updated_at, deleted_at)
SELECT
  'bc:issues:' || w.slug || '/issue/' || i.seq,
  'issues', i.workspace_id, 'issue', i.seq, i.title,
  COALESCE(rtrim(a.base_url, '/'), '') || '/dashboard/' || w.slug || '/issues/' || i.seq,
  COALESCE(i.updated_at, i.created_at, now()),
  i.deleted_at
FROM "issues"."issues" i
JOIN "platform"."workspaces" w ON w.id = i.workspace_id
LEFT JOIN "platform"."apps" a ON a.slug = 'issues'
WHERE i.seq IS NOT NULL AND i.workspace_id IS NOT NULL
ON CONFLICT (workspace_id, app, entity_type, number) DO NOTHING;--> statement-breakpoint

INSERT INTO "platform"."entities"
  (urn, app, workspace_id, entity_type, number, title, url, updated_at, deleted_at)
SELECT
  'bc:issues:' || w.slug || '/task/' || t.seq,
  'issues', t.workspace_id, 'task', t.seq, t.name,
  COALESCE(rtrim(a.base_url, '/'), '') || '/dashboard/' || w.slug || '/tasks/' || t.seq,
  COALESCE(t.updated_at, t.created_at, now()),
  t.deleted_at
FROM "issues"."tasks" t
JOIN "platform"."workspaces" w ON w.id = t.workspace_id
LEFT JOIN "platform"."apps" a ON a.slug = 'issues'
WHERE t.seq IS NOT NULL AND t.workspace_id IS NOT NULL
ON CONFLICT (workspace_id, app, entity_type, number) DO NOTHING;--> statement-breakpoint

INSERT INTO "platform"."entities"
  (urn, app, workspace_id, entity_type, number, title, url, updated_at, deleted_at)
SELECT
  'bc:issues:' || w.slug || '/project/' || p.seq,
  'issues', p.workspace_id, 'project', p.seq, p.name,
  COALESCE(rtrim(a.base_url, '/'), '') || '/dashboard/' || w.slug || '/projects/' || p.seq,
  COALESCE(p.updated_at, p.created_at, now()),
  p.deleted_at
FROM "issues"."projects" p
JOIN "platform"."workspaces" w ON w.id = p.workspace_id
LEFT JOIN "platform"."apps" a ON a.slug = 'issues'
WHERE p.seq IS NOT NULL AND p.workspace_id IS NOT NULL
ON CONFLICT (workspace_id, app, entity_type, number) DO NOTHING;--> statement-breakpoint

-- Every event in the table so far was produced by the issues app, because it is
-- the only app that has ever run. `app` records the PRODUCING app, which is why
-- a workspace or member event gets 'issues' too rather than being left null —
-- it was the issues deployment that recorded it.
UPDATE "platform"."events" SET app = 'issues' WHERE app IS NULL;--> statement-breakpoint

-- subject_urn for the events whose subject is a projected entity. Comments,
-- labels, members and invitations keep a NULL subject_urn: they are real events
-- about things that are not (yet) addressable entities, and inventing a URN for
-- them would put rows in the feed that `bk link` cannot resolve.
UPDATE "platform"."events" e
SET subject_urn = 'bc:issues:' || w.slug || '/issue/' || i.seq
FROM "issues"."issues" i
JOIN "platform"."workspaces" w ON w.id = i.workspace_id
WHERE e.entity_type = 'issue' AND e.entity_id = i.id
  AND e.workspace_id = i.workspace_id AND i.seq IS NOT NULL
  AND e.subject_urn IS NULL;--> statement-breakpoint

UPDATE "platform"."events" e
SET subject_urn = 'bc:issues:' || w.slug || '/task/' || t.seq
FROM "issues"."tasks" t
JOIN "platform"."workspaces" w ON w.id = t.workspace_id
WHERE e.entity_type = 'task' AND e.entity_id = t.id
  AND e.workspace_id = t.workspace_id AND t.seq IS NOT NULL
  AND e.subject_urn IS NULL;--> statement-breakpoint

UPDATE "platform"."events" e
SET subject_urn = 'bc:issues:' || w.slug || '/project/' || p.seq
FROM "issues"."projects" p
JOIN "platform"."workspaces" w ON w.id = p.workspace_id
WHERE e.entity_type = 'project' AND e.entity_id = p.id
  AND e.workspace_id = p.workspace_id AND p.seq IS NOT NULL
  AND e.subject_urn IS NULL;