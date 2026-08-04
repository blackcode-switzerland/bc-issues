CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"actor_user_id" integer,
	"actor_token_id" integer,
	"entity_type" varchar(30) NOT NULL,
	"entity_id" integer NOT NULL,
	"action" varchar(40) NOT NULL,
	"diff" jsonb,
	"meta" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" varchar(80)
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_actor_token_id_api_tokens_id_fk" FOREIGN KEY ("actor_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_events_ws_occurred" ON "events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_events_ws_entity" ON "events" USING btree ("workspace_id","entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_events_ws_actor" ON "events" USING btree ("workspace_id","actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_events_ws_action" ON "events" USING btree ("workspace_id","action","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_events_idempotency" ON "events" USING btree ("workspace_id","idempotency_key");