CREATE TABLE "issue_watchers" (
	"issue_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"reason" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_watchers_issue_id_user_id_pk" PRIMARY KEY("issue_id","user_id"),
	CONSTRAINT "issue_watchers_reason_check" CHECK ("issue_watchers"."reason" IN ('manual', 'assigned', 'reporter'))
);
--> statement-breakpoint
ALTER TABLE "issues" DROP CONSTRAINT "issues_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "issues" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_watchers" ADD CONSTRAINT "issue_watchers_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_watchers" ADD CONSTRAINT "issue_watchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_issue_watchers_user" ON "issue_watchers" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;