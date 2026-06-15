ALTER TABLE "labels" DROP CONSTRAINT "labels_project_id_projects_id_fk";
--> statement-breakpoint
DROP INDEX "idx_labels_project";--> statement-breakpoint
CREATE INDEX "idx_labels_workspace" ON "labels" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "labels" DROP COLUMN "project_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "role";