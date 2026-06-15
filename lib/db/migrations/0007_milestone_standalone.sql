ALTER TABLE "milestones" DROP CONSTRAINT "milestones_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "milestones" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;