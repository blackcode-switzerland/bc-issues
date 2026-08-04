-- Phase 3: split public into platform.* and issues.*
--
-- ALTER TABLE ... SET SCHEMA moves the table with its data, indexes,
-- constraints, sequences and FKs intact. Cross-schema FKs stay valid, so an
-- issues.issues row still references platform.workspaces.
--
-- comments moves to platform because migration 0032 dropped its issue_id FK.
-- Until then it was the one platform table that depended on an app.

CREATE SCHEMA IF NOT EXISTS "platform";--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "issues";--> statement-breakpoint

-- platform tables (16)
ALTER TABLE "public"."users" SET SCHEMA "platform";--> statement-breakpoint
ALTER TABLE "public"."workspaces" SET SCHEMA "platform";--> statement-breakpoint
ALTER TABLE "public"."workspace_members" SET SCHEMA "platform";--> statement-breakpoint
ALTER TABLE "public"."workspace_counters" SET SCHEMA "platform";--> statement-breakpoint
ALTER TABLE "public"."workspace_invitations" SET SCHEMA "platform";--> statement-breakpoint
ALTER TABLE "public"."api_tokens" SET SCHEMA "platform";--> statement-breakpoint
ALTER TABLE "public"."password_reset_otps" SET SCHEMA "platform";--> statement-breakpoint
ALTER TABLE "public"."email_whitelist" SET SCHEMA "platform";--> statement-breakpoint
ALTER TABLE "public"."uploads" SET SCHEMA "platform";--> statement-breakpoint
ALTER TABLE "public"."comments" SET SCHEMA "platform";--> statement-breakpoint
ALTER TABLE "public"."labels" SET SCHEMA "platform";--> statement-breakpoint
ALTER TABLE "public"."events" SET SCHEMA "platform";--> statement-breakpoint
ALTER TABLE "public"."inbox_messages" SET SCHEMA "platform";--> statement-breakpoint
ALTER TABLE "public"."transaction_log" SET SCHEMA "platform";--> statement-breakpoint
ALTER TABLE "public"."deletion_batches" SET SCHEMA "platform";--> statement-breakpoint
ALTER TABLE "public"."error_events" SET SCHEMA "platform";--> statement-breakpoint

-- issues-app tables (10)
ALTER TABLE "public"."issues" SET SCHEMA "issues";--> statement-breakpoint
ALTER TABLE "public"."tasks" SET SCHEMA "issues";--> statement-breakpoint
ALTER TABLE "public"."projects" SET SCHEMA "issues";--> statement-breakpoint
ALTER TABLE "public"."project_updates" SET SCHEMA "issues";--> statement-breakpoint
ALTER TABLE "public"."issue_labels" SET SCHEMA "issues";--> statement-breakpoint
ALTER TABLE "public"."issue_assignees" SET SCHEMA "issues";--> statement-breakpoint
ALTER TABLE "public"."issue_watchers" SET SCHEMA "issues";--> statement-breakpoint
ALTER TABLE "public"."project_labels" SET SCHEMA "issues";--> statement-breakpoint
ALTER TABLE "public"."project_members" SET SCHEMA "issues";--> statement-breakpoint
ALTER TABLE "public"."attachments" SET SCHEMA "issues";
