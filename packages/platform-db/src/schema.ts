// Platform database schema — the tables every Blackcode app shares.
//
// The split is decided by one question: "would a sales app need this?" Workspaces,
// members, comments, files, labels, activity and the inbox are org concepts, not
// issue-tracker concepts. Only tables that literally name an issue/task/project
// belong to an app. See PLATFORM-ARCHITECTURE.md §4.3.
//
// THE BOUNDARY RULE: nothing in this file may reference an app table. An app may
// FK into platform.* freely; platform may never FK into an app. If you find
// yourself importing from apps/*, the table does not belong here.
//
// NOT YET HERE — `comments`. It is polymorphic (parent_type/parent_id) and belongs
// to the platform, but it still carries a legacy `issue_id` column with a live FK
// to issues.issues. That single column is a platform->app dependency, so the table
// stays in apps/issues until Phase 3 drops it. The data is already fully
// backfilled (291 rows, 0 without parent_type, 0 mismatches) — what holds it in
// place is four code sites, not the data.

import {
  pgTable,
  serial,
  bigserial,
  bigint,
  varchar,
  text,
  integer,
  timestamp,
  boolean,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  google_id: varchar('google_id', { length: 255 }).unique(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  tagline: varchar('tagline', { length: 140 }),
  avatar_url: text('avatar_url'),
  password_hash: varchar('password_hash', { length: 255 }),
  // active_workspace_id is a soft FK — we don't enforce it via Drizzle's
  // .references() to avoid a circular declaration with workspaces. The
  // application layer keeps it in sync (set on workspace switch / create,
  // cleared on workspace delete).
  active_workspace_id: integer('active_workspace_id'),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  // Bumped whenever the password is set/reset. Existing browser sessions carry
  // a snapshot of this value; if it no longer matches, the session is treated
  // as invalid — i.e. a password reset signs you out everywhere.
  password_changed_at: timestamp('password_changed_at', { withTimezone: true }),
  last_login: timestamp('last_login', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

export const workspaces = pgTable(
  'workspaces',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 80 }).notNull(),
    slug: varchar('slug', { length: 40 }).notNull(),
    logo_url: text('logo_url'),
    owner_id: integer('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
    // Future-proofing for storage quotas: a hard cap (in bytes) on the total
    // size of files uploaded into this workspace. NULL = unlimited (the only
    // behaviour today — nothing enforces this yet). Current usage is the SUM of
    // `uploads.size`; enforcement, when added, compares the two at upload time.
    storage_limit_bytes: bigint('storage_limit_bytes', { mode: 'number' }),
  },
  (t) => ({
    slugUniq: uniqueIndex('uq_workspaces_slug').on(t.slug),
    ownerIdx: index('idx_workspaces_owner').on(t.owner_id),
  })
)

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).default('member').notNull(),
    joined_at: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniq: uniqueIndex('uq_workspace_members_ws_user').on(t.workspace_id, t.user_id),
    userIdx: index('idx_workspace_members_user').on(t.user_id),
    roleCheck: check(
      'workspace_members_role_check',
      sql`${t.role} IN ('owner', 'member')`
    ),
  })
)

export const workspaceCounters = pgTable('workspace_counters', {
  workspace_id: integer('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  last_issue_seq: integer('last_issue_seq').default(0).notNull(),
  // Per-workspace, per-type sequences for the human-facing #number shown in the
  // UI and URL. Allocated alongside the row insert (see allocateNext*Seq).
  last_project_seq: integer('last_project_seq').default(0).notNull(),
  last_task_seq: integer('last_task_seq').default(0).notNull(),
})

export const workspaceInvitations = pgTable(
  'workspace_invitations',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    invited_by: integer('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).default('member').notNull(),
    token: varchar('token', { length: 64 }).notNull(),
    status: varchar('status', { length: 20 }).default('pending').notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    accepted_at: timestamp('accepted_at', { withTimezone: true }),
    accepted_by: integer('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tokenUniq: uniqueIndex('uq_workspace_invitations_token').on(t.token),
    workspaceIdx: index('idx_workspace_invitations_ws').on(t.workspace_id),
    emailIdx: index('idx_workspace_invitations_email').on(t.email),
    statusCheck: check(
      'workspace_invitations_status_check',
      sql`${t.status} IN ('pending', 'accepted', 'revoked', 'expired', 'declined')`
    ),
  })
)

export const uploads = pgTable(
  'uploads',
  {
    id: serial('id').primaryKey(),
    // Nullable: an upload whose workspace couldn't be determined is still
    // recorded (never lost) — it just won't appear under a workspace until
    // attributed. ON DELETE CASCADE: dropping a workspace clears its ledger.
    workspace_id: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    // The public URL stored in content bodies / attachments — the join key for
    // reference counting. Unique so recordUpload is idempotent.
    url: text('url').notNull(),
    // Blob pathname (or local /uploads path) — kept for storage-side operations.
    pathname: text('pathname'),
    filename: varchar('filename', { length: 255 }).notNull(),
    // bigint: files are capped at 100MB today but the column shouldn't be the
    // limiting factor if that grows. NULL when the size wasn't reported.
    size: bigint('size', { mode: 'number' }),
    mime_type: varchar('mime_type', { length: 100 }),
    uploaded_by: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    urlUniq: uniqueIndex('uq_uploads_url').on(t.url),
    workspaceIdx: index('idx_uploads_workspace').on(t.workspace_id),
  })
)

export const labels = pgTable(
  'labels',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 50 }).notNull(),
    color: varchar('color', { length: 7 }).default('#6b7280'),
    description: text('description'),
    created_by: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    wsIdx: index('idx_labels_workspace').on(t.workspace_id),
  })
)

export const transactionLog = pgTable(
  'transaction_log',
  {
    id: serial('id').primaryKey(),
    user_id: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    operation_type: varchar('operation_type', { length: 20 }).notNull(),
    table_name: varchar('table_name', { length: 50 }).notNull(),
    record_id: integer('record_id').notNull(),
    old_data: jsonb('old_data'),
    new_data: jsonb('new_data'),
    rolled_back: boolean('rolled_back').default(false),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_transaction_log_user').on(t.user_id),
    createdIdx: index('idx_transaction_log_created').on(t.created_at),
  })
)

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: serial('id').primaryKey(),
    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    token_hash: varchar('token_hash', { length: 128 }).notNull(),
    token_prefix: varchar('token_prefix', { length: 16 }).notNull(),
    scopes: text('scopes').array().default(sql`ARRAY['full']::text[]`).notNull(),
    last_used_at: timestamp('last_used_at', { withTimezone: true }),
    expires_at: timestamp('expires_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_api_tokens_user').on(t.user_id),
    prefixIdx: index('idx_api_tokens_prefix').on(t.token_prefix),
    hashUniq: uniqueIndex('uq_api_tokens_hash').on(t.token_hash),
  })
)

// password_reset_otps — short-lived one-time codes emailed to a user to verify
// email ownership before setting a new password. Used by both the logged-out
// "forgot password" flow (by email) and the in-app settings flow (session
// email). We store only a hash of the code, cap attempts, and expire fast.

export const passwordResetOtps = pgTable(
  'password_reset_otps',
  {
    id: serial('id').primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    user_id: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    otp_hash: varchar('otp_hash', { length: 128 }).notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumed_at: timestamp('consumed_at', { withTimezone: true }),
    attempts: integer('attempts').default(0).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    emailCreatedIdx: index('idx_password_reset_email_created').on(t.email, t.created_at),
  })
)

// issue_watchers — explicit list of users who get notifications for an issue.
// Reason captures *why* they're watching: manual subscription, auto on assign,
// auto on reporter. Auto-watchers are removed when their reason no longer
// applies (e.g. assignee unassigned), unless reason='manual'.

export const events = pgTable(
  'events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    actor_user_id: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actor_token_id: integer('actor_token_id').references(() => apiTokens.id, {
      onDelete: 'set null',
    }),
    entity_type: varchar('entity_type', { length: 30 }).notNull(),
    entity_id: integer('entity_id').notNull(),
    action: varchar('action', { length: 40 }).notNull(),
    diff: jsonb('diff'),
    meta: jsonb('meta'),
    occurred_at: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    idempotency_key: varchar('idempotency_key', { length: 80 }),
  },
  (t) => ({
    wsOccurredIdx: index('idx_events_ws_occurred').on(t.workspace_id, t.occurred_at),
    wsEntityIdx: index('idx_events_ws_entity').on(
      t.workspace_id,
      t.entity_type,
      t.entity_id,
      t.occurred_at
    ),
    wsActorIdx: index('idx_events_ws_actor').on(t.workspace_id, t.actor_user_id, t.occurred_at),
    wsActionIdx: index('idx_events_ws_action').on(t.workspace_id, t.action, t.occurred_at),
    idempUniq: uniqueIndex('uq_events_idempotency').on(t.workspace_id, t.idempotency_key),
  })
)

// inbox_messages — per-user projection of events. See §1.5 of the rebuild doc.
//
// event_id is nullable because some inbox rows are synthetic (e.g. system
// announcements, pre-signup invitation materialization). workspace_id is
// nullable for cross-workspace messages but typically populated.
//
// payload carries everything needed to render the message without joining
// events — this keeps the inbox UI snappy and survives the source event being
// deleted (e.g. workspace deletion via cascade).

export const inboxMessages = pgTable(
  'inbox_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    event_id: integer('event_id'),
    workspace_id: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 40 }).notNull(),
    entity_type: varchar('entity_type', { length: 30 }),
    entity_id: integer('entity_id'),
    actor_user_id: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    payload: jsonb('payload').notNull(),
    read_at: timestamp('read_at', { withTimezone: true }),
    archived_at: timestamp('archived_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userCreatedIdx: index('idx_inbox_user_created').on(t.user_id, t.created_at),
    userUnreadIdx: index('idx_inbox_user_unread').on(t.user_id, t.read_at),
    userTypeIdx: index('idx_inbox_user_type').on(t.user_id, t.type),
    userWsIdx: index('idx_inbox_user_ws').on(t.user_id, t.workspace_id),
  })
)

// Recycle bin (0022): one row per delete operation. Groups the binned items so
// restore can be batch-aware — items deleted together with their parent restore
// as a group; items deleted alone restore standalone. `mode` records whether the
// children were cascaded into the bin or detached (kept active).

export const deletionBatches = pgTable(
  'deletion_batches',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    actor_user_id: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    mode: varchar('mode', { length: 10 }).notNull(),
    root_type: varchar('root_type', { length: 20 }).notNull(),
    root_id: integer('root_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    wsIdx: index('idx_deletion_batches_ws').on(t.workspace_id, t.created_at),
    modeCheck: check('deletion_batches_mode_check', sql`${t.mode} IN ('cascade', 'detach')`),
    rootTypeCheck: check(
      'deletion_batches_root_type_check',
      sql`${t.root_type} IN ('project', 'task', 'issue')`
    ),
  })
)

export const errorEvents = pgTable(
  'error_events',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id'),
    user_id: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    level: varchar('level', { length: 10 }).notNull().default('error'),
    code: varchar('code', { length: 50 }),
    message: text('message').notNull(),
    stack: text('stack'),
    route: varchar('route', { length: 255 }),
    method: varchar('method', { length: 10 }),
    status_code: integer('status_code'),
    context: jsonb('context'),
    // Triage state, managed from the super-admin Errors tab.
    resolved: boolean('resolved').notNull().default(false),
    resolved_at: timestamp('resolved_at', { withTimezone: true }),
    resolved_by: integer('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    occurred_at: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    occurredIdx: index('idx_error_events_occurred').on(t.occurred_at),
    levelIdx: index('idx_error_events_level').on(t.level),
    codeIdx: index('idx_error_events_code').on(t.code),
    routeIdx: index('idx_error_events_route').on(t.route),
    resolvedIdx: index('idx_error_events_resolved').on(t.resolved),
  })
)

export const emailWhitelist = pgTable(
  'email_whitelist',
  {
    id: serial('id').primaryKey(),
    type: varchar('type', { length: 10 }).notNull(), // 'email' | 'domain'
    value: varchar('value', { length: 255 }).notNull(),
    added_by: integer('added_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    typeValueUniq: uniqueIndex('uq_email_whitelist_type_value').on(t.type, t.value),
    typeCheck: check('email_whitelist_type_check', sql`${t.type} IN ('email', 'domain')`),
  })
)

// ---- inferred row types ----

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Upload = typeof uploads.$inferSelect
export type NewUpload = typeof uploads.$inferInsert
export type Label = typeof labels.$inferSelect
export type TransactionLogEntry = typeof transactionLog.$inferSelect
export type ApiToken = typeof apiTokens.$inferSelect
export type NewApiToken = typeof apiTokens.$inferInsert
export type PasswordResetOtp = typeof passwordResetOtps.$inferSelect
export type NewPasswordResetOtp = typeof passwordResetOtps.$inferInsert
export type ErrorEvent = typeof errorEvents.$inferSelect
export type NewErrorEvent = typeof errorEvents.$inferInsert
export type DeletionBatch = typeof deletionBatches.$inferSelect
export type NewDeletionBatch = typeof deletionBatches.$inferInsert
export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert
export type WorkspaceMember = typeof workspaceMembers.$inferSelect
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert
export type WorkspaceCounter = typeof workspaceCounters.$inferSelect
export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect
export type NewWorkspaceInvitation = typeof workspaceInvitations.$inferInsert
export type Event = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
export type InboxMessage = typeof inboxMessages.$inferSelect
export type NewInboxMessage = typeof inboxMessages.$inferInsert
export type EmailWhitelistEntry = typeof emailWhitelist.$inferSelect
export type NewEmailWhitelistEntry = typeof emailWhitelist.$inferInsert
