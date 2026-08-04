CREATE TABLE "error_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer,
	"user_id" integer,
	"level" varchar(10) DEFAULT 'error' NOT NULL,
	"code" varchar(50),
	"message" text NOT NULL,
	"stack" text,
	"route" varchar(255),
	"method" varchar(10),
	"status_code" integer,
	"context" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_error_events_occurred" ON "error_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idx_error_events_level" ON "error_events" USING btree ("level");--> statement-breakpoint
CREATE INDEX "idx_error_events_code" ON "error_events" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_error_events_route" ON "error_events" USING btree ("route");