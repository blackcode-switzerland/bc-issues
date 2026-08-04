-- Phase 4: the app registry, plus per-workspace and per-user app access.
--
-- Three new platform tables and one new column:
--   platform.apps            — one row per app in the suite. `slug` is the PK
--                              because that slug is what appears in URNs, in the
--                              CLI namespace and in guide folders.
--   platform.workspace_apps  — this app is turned on for this organisation, and
--                              how it hands out access (all_members | invite_only)
--   platform.app_access      — this user may use this app in this organisation
--   workspace_invitations.app — NULL = org-level invite; set = invited into one app
--
-- THE BACKFILL IS IN THIS FILE ON PURPOSE, not in a separate migration. The DDL
-- alone is a lockout: `workspace_apps` with no rows means every workspace is
-- running no apps, and `app_access` with no rows means nobody may use them. The
-- two must never be applied apart, so they are one file.
--
-- Every INSERT is ON CONFLICT DO NOTHING, so re-running is a no-op. Rollback is
-- docs/sql/phase4-rollback.sql; enforcement is separately behind
-- PLATFORM_ENFORCE_APP_ACCESS, so the code half can be switched off without
-- touching the schema.
--
-- app_access's FK is to workspace_members (workspace_id, user_id), not to
-- workspaces: it makes access-without-membership unrepresentable, and removing a
-- member drops their access by cascade rather than by remembering to.

CREATE TABLE "platform"."app_access" (
	"workspace_id" integer NOT NULL,
	"app" varchar(40) NOT NULL,
	"user_id" integer NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" integer,
	CONSTRAINT "app_access_workspace_id_app_user_id_pk" PRIMARY KEY("workspace_id","app","user_id"),
	CONSTRAINT "app_access_role_check" CHECK ("platform"."app_access"."role" IN ('owner', 'member'))
);
--> statement-breakpoint
CREATE TABLE "platform"."apps" (
	"slug" varchar(40) PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text,
	"base_url" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."workspace_apps" (
	"workspace_id" integer NOT NULL,
	"app" varchar(40) NOT NULL,
	"enabled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enabled_by" integer,
	"default_access" varchar(20) DEFAULT 'all_members' NOT NULL,
	CONSTRAINT "workspace_apps_workspace_id_app_pk" PRIMARY KEY("workspace_id","app"),
	CONSTRAINT "workspace_apps_default_access_check" CHECK ("platform"."workspace_apps"."default_access" IN ('all_members', 'invite_only'))
);
--> statement-breakpoint
ALTER TABLE "platform"."workspace_invitations" ADD COLUMN "app" varchar(40);--> statement-breakpoint
ALTER TABLE "platform"."app_access" ADD CONSTRAINT "app_access_app_apps_slug_fk" FOREIGN KEY ("app") REFERENCES "platform"."apps"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."app_access" ADD CONSTRAINT "app_access_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "platform"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."app_access" ADD CONSTRAINT "app_access_membership_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "platform"."workspace_members"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."workspace_apps" ADD CONSTRAINT "workspace_apps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "platform"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."workspace_apps" ADD CONSTRAINT "workspace_apps_app_apps_slug_fk" FOREIGN KEY ("app") REFERENCES "platform"."apps"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."workspace_apps" ADD CONSTRAINT "workspace_apps_enabled_by_users_id_fk" FOREIGN KEY ("enabled_by") REFERENCES "platform"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_app_access_user_app" ON "platform"."app_access" USING btree ("user_id","app");--> statement-breakpoint
CREATE INDEX "idx_workspace_apps_app" ON "platform"."workspace_apps" USING btree ("app");--> statement-breakpoint
ALTER TABLE "platform"."workspace_invitations" ADD CONSTRAINT "workspace_invitations_app_apps_slug_fk" FOREIGN KEY ("app") REFERENCES "platform"."apps"("slug") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- BACKFILL — the half that decides whether the team can still log in.
-- ---------------------------------------------------------------------------

-- 1. Register the one app that exists.
INSERT INTO "platform"."apps" ("slug", "name", "description", "base_url")
VALUES (
  'issues',
  'Blackcode Issues',
  'AI-native issue tracker: projects, tasks, issues, comments and attachments.',
  'https://issues.blackcode.ch'
)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint

-- 2. Every existing workspace runs it, default-on. enabled_by is NULL because no
--    person enabled it — the migration did.
INSERT INTO "platform"."workspace_apps" ("workspace_id", "app", "enabled_by", "default_access")
SELECT "id", 'issues', NULL, 'all_members' FROM "platform"."workspaces"
ON CONFLICT ("workspace_id", "app") DO NOTHING;--> statement-breakpoint

-- 3. Every existing member keeps working, with their workspace role mirrored.
--    This is the statement that must match workspace_members row-for-row; the
--    orphan check in PLATFORM-MIGRATION-PLAN.md Phase 4 verifies it, and
--    findOrphanedMembers() in platform-db/src/app-access.ts is the same query.
INSERT INTO "platform"."app_access" ("workspace_id", "app", "user_id", "role", "granted_by")
SELECT "workspace_id", 'issues', "user_id", "role", NULL FROM "platform"."workspace_members"
ON CONFLICT ("workspace_id", "app", "user_id") DO NOTHING;
