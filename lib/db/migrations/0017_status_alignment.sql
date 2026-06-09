-- Remap existing statuses to the aligned sets.
-- Issues: drop 'blocked' and 'in_review'.
UPDATE "issues" SET "status" = 'todo' WHERE "status" = 'blocked';
--> statement-breakpoint
UPDATE "issues" SET "status" = 'in_progress' WHERE "status" = 'in_review';
--> statement-breakpoint
-- Projects: active/archived/completed -> backlog/planned/in_progress/completed/cancelled.
UPDATE "projects" SET "status" = 'in_progress' WHERE "status" = 'active';
--> statement-breakpoint
UPDATE "projects" SET "status" = 'cancelled' WHERE "status" = 'archived';
