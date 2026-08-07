-- The scaffold app, migration 0001 — the schema, the table, the #number counter.
--
-- Hand-written rather than `drizzle-kit generate`d, because the schema has to
-- exist before any table in it and the generator cannot express that ordering.
-- `apps/sales` 0001 and `apps/issues` 0037, 0041-0043 are hand-written for the
-- same kind of reason.
--
-- ENTIRELY ADDITIVE and touches nothing outside `scaffold`. It does NOT insert
-- the `platform.apps` row and it does NOT install a blob-reference trigger —
-- both belong to 0002 and to the human provisioning steps, and the ORDER is the
-- one irreversible thing here. See the header of 0002 and
-- docs/adding-an-app.md §2.
--
-- Re-runnable: every CREATE is IF NOT EXISTS.
-- Rollback: drop the schema, but read 0002's rollback note first.

CREATE SCHEMA IF NOT EXISTS scaffold;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS scaffold.notes (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES platform.workspaces(id) ON DELETE CASCADE,
  -- The workspace-scoped #NUMBER. This is the address every agent, URN and CLI
  -- command uses; `id` is an internal detail no surface prints.
  seq           integer NOT NULL,
  title         varchar(200) NOT NULL,
  body          text,
  created_by    integer REFERENCES platform.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Soft delete. NULL means live. See the schema.ts comment for why a hard
  -- DELETE here would make a file deletable the instant somebody pressed
  -- delete.
  deleted_at    timestamptz
);--> statement-breakpoint

-- The #number is unique PER WORKSPACE, and this index is what makes the counter
-- below safe: two concurrent creates that somehow read the same value collide
-- here rather than silently sharing a number.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notes_ws_seq ON scaffold.notes (workspace_id, seq);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notes_ws_live ON scaffold.notes (workspace_id) WHERE deleted_at IS NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- THE COUNTER, AND WHY IT IS NOT `platform.workspace_counters`
-- ---------------------------------------------------------------------------
-- That table has FIXED columns — `last_issue_seq`, `last_project_seq`,
-- `last_task_seq` — so it is shaped for exactly one app's entity types. A second
-- app allocating a #number from it would have to ALTER a platform table every
-- time it added an entity, which is precisely the coupling the platform/app
-- split exists to prevent.
--
-- So each app keeps its own counter, in its own schema. Copy this pattern.
CREATE TABLE IF NOT EXISTS scaffold.note_counters (
  workspace_id   integer PRIMARY KEY REFERENCES platform.workspaces(id) ON DELETE CASCADE,
  last_note_seq  integer NOT NULL DEFAULT 0
);
