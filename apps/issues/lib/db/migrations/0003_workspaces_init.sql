CREATE TABLE "workspace_counters" (
	"workspace_id" integer PRIMARY KEY NOT NULL,
	"last_issue_seq" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"email" varchar(255) NOT NULL,
	"invited_by" integer NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"token" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invitations_status_check" CHECK ("workspace_invitations"."status" IN ('pending', 'accepted', 'revoked', 'expired', 'declined'))
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_role_check" CHECK ("workspace_members"."role" IN ('owner', 'member'))
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"slug" varchar(40) NOT NULL,
	"key" varchar(6) NOT NULL,
	"logo_url" text,
	"owner_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "workspace_id" integer;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "workspace_id" integer;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "parent_type" varchar(20);--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "parent_id" integer;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "mentions" integer[];--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "workspace_id" integer;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "seq" integer;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "labels" ADD COLUMN "workspace_id" integer;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "workspace_id" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "workspace_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tagline" varchar(140);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active_workspace_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_counters" ADD CONSTRAINT "workspace_counters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_workspace_invitations_token" ON "workspace_invitations" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_workspace_invitations_ws" ON "workspace_invitations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_workspace_invitations_email" ON "workspace_invitations" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_workspace_members_ws_user" ON "workspace_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_workspace_members_user" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_workspaces_slug" ON "workspaces" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_workspaces_key" ON "workspaces" USING btree ("key");--> statement-breakpoint
CREATE INDEX "idx_workspaces_owner" ON "workspaces" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_comments_parent" ON "comments" USING btree ("parent_type","parent_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_issues_workspace" ON "issues" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_issues_workspace_seq" ON "issues" USING btree ("workspace_id","seq");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_type_check" CHECK ("comments"."parent_type" IS NULL OR "comments"."parent_type" IN ('issue', 'milestone', 'project'));