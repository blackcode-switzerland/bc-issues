CREATE TABLE "api_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"token_prefix" varchar(16) NOT NULL,
	"scopes" text[] DEFAULT ARRAY['full']::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"issue_id" integer NOT NULL,
	"filename" varchar(255) NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer,
	"mime_type" varchar(100),
	"uploaded_by" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"issue_id" integer NOT NULL,
	"user_id" integer,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "issue_labels" (
	"issue_id" integer NOT NULL,
	"label_id" integer NOT NULL,
	CONSTRAINT "issue_labels_issue_id_label_id_pk" PRIMARY KEY("issue_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"milestone_id" integer,
	"title" varchar(200) NOT NULL,
	"description" text,
	"status" varchar(50) DEFAULT 'backlog',
	"priority" integer DEFAULT 3,
	"assignee_id" integer,
	"reporter_id" integer,
	"start_date" date,
	"due_date" date,
	"estimated_hours" numeric(5, 1),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "issues_priority_check" CHECK ("issues"."priority" >= 1 AND "issues"."priority" <= 5)
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" varchar(50) NOT NULL,
	"color" varchar(7) DEFAULT '#6b7280',
	"description" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"due_date" date,
	"status" varchar(50) DEFAULT 'active',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" varchar(50) DEFAULT 'member',
	"joined_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"status" varchar(50) DEFAULT 'active',
	"owner_id" integer,
	"priority" varchar(10) DEFAULT 'P2',
	"visibility" varchar(20) DEFAULT 'team',
	"color" varchar(10) DEFAULT '#3B82F6',
	"icon_url" text,
	"banner_url" text,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transaction_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"operation_type" varchar(20) NOT NULL,
	"table_name" varchar(50) NOT NULL,
	"record_id" integer NOT NULL,
	"old_data" jsonb,
	"new_data" jsonb,
	"rolled_back" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"google_id" varchar(255),
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"avatar_url" text,
	"role" varchar(50) DEFAULT 'member' NOT NULL,
	"last_login" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_log" ADD CONSTRAINT "transaction_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_api_tokens_user" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_api_tokens_prefix" ON "api_tokens" USING btree ("token_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_api_tokens_hash" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_attachments_issue" ON "attachments" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "idx_comments_issue" ON "comments" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "idx_issues_project" ON "issues" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_issues_status" ON "issues" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_issues_assignee" ON "issues" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "idx_issues_milestone" ON "issues" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "idx_issues_priority" ON "issues" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "idx_labels_project" ON "labels" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_milestones_project" ON "milestones" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_project_members_project" ON "project_members" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_project_members_user" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_project_members_project_user" ON "project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_transaction_log_user" ON "transaction_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_transaction_log_created" ON "transaction_log" USING btree ("created_at");