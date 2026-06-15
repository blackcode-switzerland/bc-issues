-- Triage state for error_events, managed from the super-admin Errors tab.
-- resolved          -> whether a super admin has marked the error as handled.
-- resolved_at / _by -> audit of who resolved it and when.
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS resolved boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
--> statement-breakpoint
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS resolved_by integer REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_error_events_resolved ON error_events USING btree (resolved);
