CREATE TABLE "inbox_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"event_id" integer,
	"workspace_id" integer,
	"type" varchar(40) NOT NULL,
	"entity_type" varchar(30),
	"entity_id" integer,
	"actor_user_id" integer,
	"payload" jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_inbox_user_created" ON "inbox_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_inbox_user_unread" ON "inbox_messages" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "idx_inbox_user_type" ON "inbox_messages" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "idx_inbox_user_ws" ON "inbox_messages" USING btree ("user_id","workspace_id");