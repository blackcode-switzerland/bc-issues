ALTER TABLE "comments" DROP CONSTRAINT "comments_issue_id_issues_id_fk";
--> statement-breakpoint
DROP INDEX "idx_comments_issue";--> statement-breakpoint
ALTER TABLE "comments" DROP COLUMN "issue_id";