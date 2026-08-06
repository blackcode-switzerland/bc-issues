// This app's database schema: the shared platform tables plus its own.
//
// THE BOUNDARY RULE: this app's tables live in ITS OWN Postgres schema, and it
// may not read or write another app's. That is enforced by grants, not by
// review — `template_app` simply has no SELECT on `issues.*`. See
// docs/platform-architecture.md §4.3 and docs/sql/app-role.sql.
//
// Deciding where a new table goes is one question: "would a second app need this
// unchanged?" Yes → `packages/platform-db` (workspaces, members, comments,
// labels, uploads, events). No → here.
import { pgSchema, serial, varchar, text, integer, timestamp } from 'drizzle-orm/pg-core'
import { users, workspaces } from '@blackcode/platform-db'

/** This app's Postgres schema. Named for the app slug — see lib/app.ts. */
export const templateSchema = pgSchema('template')

// Re-export the platform tables so `@/lib/db/schema` is the single import site
// for the whole schema, exactly as it is in apps/issues.
export * from '@blackcode/platform-db/schema'

/**
 * The one entity this scaffold defines, so that every layer below has something
 * real to carry: a route, a query, a CLI command, a guide topic.
 *
 * Note `seq` — the workspace-scoped **#number**. Every addressable entity in the
 * platform has one, because that is what agents and URNs use
 * (`bc:_template:acme/note/7`); the serial `id` is an internal detail that no
 * surface should ever print. `apps/issues` learned this the hard way: `bk trash`
 * exposed row ids until Phase 8.
 */
export const notes = templateSchema.table('notes', {
  id: serial('id').primaryKey(),
  workspace_id: integer('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  /** Workspace-scoped #number. Allocated from platform.workspace_counters. */
  seq: integer('seq').notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  body: text('body'),
  created_by: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type Note = typeof notes.$inferSelect

/**
 * This app's #number counter — one row per workspace, per entity type.
 *
 * ── WHY NOT `platform.workspace_counters` ────────────────────────────────────
 * Because it cannot be used. That table has FIXED columns — `last_issue_seq`,
 * `last_project_seq`, `last_task_seq` — so it is shaped for exactly one app's
 * entity types. A second app allocating a #number from it would have to ALTER a
 * platform table every time it added an entity, which is precisely the coupling
 * the platform/app split exists to prevent.
 *
 * So each app keeps its own counter, in its own schema, and that is the pattern
 * to copy. (Generalising the platform table to `(workspace_id, entity_type,
 * last_value)` would be better and is recorded as a follow-up — but it is a
 * migration of a shared table, not something a new app should have to do.)
 */
export const noteCounters = templateSchema.table('note_counters', {
  workspace_id: integer('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  last_note_seq: integer('last_note_seq').default(0).notNull(),
})
