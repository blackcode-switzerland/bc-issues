import {
  pgTable,
  serial,
  bigserial,
  varchar,
  text,
  integer,
  decimal,
  date,
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
    key: varchar('key', { length: 6 }).notNull(),
    logo_url: text('logo_url'),
    owner_id: integer('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    slugUniq: uniqueIndex('uq_workspaces_slug').on(t.slug),
    keyUniq: uniqueIndex('uq_workspaces_key').on(t.key),
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

export const projects = pgTable(
  'projects',
  {
  id: serial('id').primaryKey(),
  // Phase 1: nullable during backfill window. Phase 13 cleanup tightens to NOT NULL.
  workspace_id: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  summary: text('summary'),
  description: text('description'),
  status: varchar('status', { length: 50 }).default('active'),
  owner_id: integer('owner_id').references(() => users.id, { onDelete: 'set null' }),
  priority: varchar('priority', { length: 10 }).default('P2'),
  visibility: varchar('visibility', { length: 20 }).default('team'),
  color: varchar('color', { length: 10 }).default('#3B82F6'),
  // Named icon key (lucide icon name, e.g. "Rocket"). Rendered with `color`.
  icon: varchar('icon', { length: 40 }),
  icon_url: text('icon_url'),
  banner_url: text('banner_url'),
  start_date: date('start_date'),
  end_date: date('end_date'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  position: integer('position'),
  // Recycle bin (0022): deleted_at IS NULL => active. Soft-delete keeps the row
  // so child FKs survive for batch-aware restore. See lib/db/queries/deletion.ts.
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  deleted_by: integer('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  delete_batch_id: integer('delete_batch_id'),
  },
  (t) => ({
    deletedIdx: index('idx_projects_deleted').on(t.workspace_id, t.deleted_at),
    batchIdx: index('idx_projects_batch').on(t.delete_batch_id),
  })
)

// Project status updates ("health" posts). Each project accumulates a feed of
// updates; the latest one is the project's current health. status is one of
// on_track / at_risk / off_track; body is rich-text HTML.
export const projectUpdates = pgTable(
  'project_updates',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    project_id: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull(),
    body: text('body'),
    author_id: integer('author_id').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    projectIdx: index('idx_project_updates_project').on(t.project_id, t.created_at),
    statusCheck: check(
      'project_updates_status_check',
      sql`${t.status} IN ('on_track', 'at_risk', 'off_track')`
    ),
  })
)

export const milestones = pgTable(
  'milestones',
  {
    id: serial('id').primaryKey(),
    // Phase 1: nullable during backfill. Phase 13 tightens.
    workspace_id: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    // Phase 7: project_id is now optional — milestones can be standalone within
    // a workspace. ON DELETE SET NULL so deleting the project doesn't take the
    // milestone with it.
    project_id: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    due_date: date('due_date'),
    status: varchar('status', { length: 50 }).default('active'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    // Recycle bin (0022). See lib/db/queries/deletion.ts.
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
    deleted_by: integer('deleted_by').references(() => users.id, { onDelete: 'set null' }),
    delete_batch_id: integer('delete_batch_id'),
  },
  (t) => ({
    projectIdx: index('idx_milestones_project').on(t.project_id),
    deletedIdx: index('idx_milestones_deleted').on(t.workspace_id, t.deleted_at),
    batchIdx: index('idx_milestones_batch').on(t.delete_batch_id),
  })
)

export const issues = pgTable(
  'issues',
  {
    id: serial('id').primaryKey(),
    // Phase 1: nullable during backfill. Phase 13 tightens.
    workspace_id: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    // Workspace-scoped sequence; allocated via workspace_counters. Nullable
    // during backfill — 0004 populates and the application sets it going
    // forward. Phase 13 tightens to NOT NULL.
    seq: integer('seq'),
    // Phase 8: project_id is optional — issues can be standalone within a
    // workspace. ON DELETE SET NULL so deleting the project doesn't take its
    // issues with it.
    project_id: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    milestone_id: integer('milestone_id').references(() => milestones.id, {
      onDelete: 'set null',
    }),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 50 }).default('backlog'),
    priority: integer('priority').default(3),
    assignee_id: integer('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    reporter_id: integer('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    start_date: date('start_date'),
    due_date: date('due_date'),
    estimated_hours: decimal('estimated_hours', { precision: 5, scale: 1 }),
    completed_at: timestamp('completed_at', { withTimezone: true }),
    cancelled_at: timestamp('cancelled_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    position: integer('position'),
    // Recycle bin (0022). See lib/db/queries/deletion.ts.
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
    deleted_by: integer('deleted_by').references(() => users.id, { onDelete: 'set null' }),
    delete_batch_id: integer('delete_batch_id'),
  },
  (t) => ({
    projectIdx: index('idx_issues_project').on(t.project_id),
    statusIdx: index('idx_issues_status').on(t.status),
    assigneeIdx: index('idx_issues_assignee').on(t.assignee_id),
    milestoneIdx: index('idx_issues_milestone').on(t.milestone_id),
    priorityIdx: index('idx_issues_priority').on(t.priority),
    workspaceIdx: index('idx_issues_workspace').on(t.workspace_id),
    workspaceSeqUniq: uniqueIndex('uq_issues_workspace_seq').on(t.workspace_id, t.seq),
    deletedIdx: index('idx_issues_deleted').on(t.workspace_id, t.deleted_at),
    batchIdx: index('idx_issues_batch').on(t.delete_batch_id),
    priorityCheck: check('issues_priority_check', sql`${t.priority} >= 1 AND ${t.priority} <= 5`),
  })
)

export const comments = pgTable(
  'comments',
  {
    id: serial('id').primaryKey(),
    // Phase 1: nullable during backfill. Phase 13 tightens.
    workspace_id: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    // Polymorphic parent: 'issue' | 'milestone' | 'project'.
    // Existing rows backfill with parent_type='issue', parent_id=issue_id.
    // We keep `issue_id` in place for one release for safety; new code uses parent_*.
    parent_type: varchar('parent_type', { length: 20 }),
    parent_id: integer('parent_id'),
    // Phase 9: comments are polymorphic via parent_type/parent_id. The legacy
    // issue_id column stays for one release (data + legacy queries) but is
    // now nullable since milestone/project comments don't have an issue.
    issue_id: integer('issue_id').references(() => issues.id, { onDelete: 'cascade' }),
    user_id: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    content: text('content').notNull(),
    mentions: integer('mentions').array(),
    parent_comment_id: integer('parent_comment_id'),
    edited_at: timestamp('edited_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    issueIdx: index('idx_comments_issue').on(t.issue_id),
    parentIdx: index('idx_comments_parent').on(t.parent_type, t.parent_id, t.created_at),
    parentCommentIdx: index('idx_comments_parent_comment').on(t.parent_comment_id),
    parentTypeCheck: check(
      'comments_parent_type_check',
      sql`${t.parent_type} IS NULL OR ${t.parent_type} IN ('issue', 'milestone', 'project')`
    ),
  })
)

export const attachments = pgTable(
  'attachments',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    issue_id: integer('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    filename: varchar('filename', { length: 255 }).notNull(),
    file_url: text('file_url').notNull(),
    file_size: integer('file_size'),
    mime_type: varchar('mime_type', { length: 100 }),
    uploaded_by: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    issueIdx: index('idx_attachments_issue').on(t.issue_id),
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

export const issueLabels = pgTable(
  'issue_labels',
  {
    issue_id: integer('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    label_id: integer('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.issue_id, t.label_id] }),
  })
)

// Project ↔ label association. Reuses the workspace-scoped labels table.
export const projectLabels = pgTable(
  'project_labels',
  {
    project_id: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    label_id: integer('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.project_id, t.label_id] }),
    labelIdx: index('idx_project_labels_label').on(t.label_id),
  })
)

export const projectMembers = pgTable(
  'project_members',
  {
    id: serial('id').primaryKey(),
    project_id: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 50 }).default('member'),
    joined_at: timestamp('joined_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    projectIdx: index('idx_project_members_project').on(t.project_id),
    userIdx: index('idx_project_members_user').on(t.user_id),
    uniq: uniqueIndex('uq_project_members_project_user').on(t.project_id, t.user_id),
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
export const issueWatchers = pgTable(
  'issue_watchers',
  {
    issue_id: integer('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: varchar('reason', { length: 20 }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.issue_id, t.user_id] }),
    userIdx: index('idx_issue_watchers_user').on(t.user_id),
    reasonCheck: check(
      'issue_watchers_reason_check',
      sql`${t.reason} IN ('manual', 'assigned', 'reporter')`
    ),
  })
)

// events — the spine. Every domain mutation records a row in the same
// transaction. Activity feed, inbox, analytics, and undo all read from here.
// See §1.4 of docs/architecture-rebuild.md.
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
      sql`${t.root_type} IN ('project', 'milestone', 'issue')`
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
    occurred_at: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    occurredIdx: index('idx_error_events_occurred').on(t.occurred_at),
    levelIdx: index('idx_error_events_level').on(t.level),
    codeIdx: index('idx_error_events_code').on(t.code),
    routeIdx: index('idx_error_events_route').on(t.route),
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

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Milestone = typeof milestones.$inferSelect
export type Issue = typeof issues.$inferSelect
export type NewIssue = typeof issues.$inferInsert
export type Comment = typeof comments.$inferSelect
export type ProjectUpdate = typeof projectUpdates.$inferSelect
export type NewProjectUpdate = typeof projectUpdates.$inferInsert
export type Attachment = typeof attachments.$inferSelect
export type Label = typeof labels.$inferSelect
export type ProjectMember = typeof projectMembers.$inferSelect
export type TransactionLogEntry = typeof transactionLog.$inferSelect
export type ApiToken = typeof apiTokens.$inferSelect
export type NewApiToken = typeof apiTokens.$inferInsert
export type PasswordResetOtp = typeof passwordResetOtps.$inferSelect
export type NewPasswordResetOtp = typeof passwordResetOtps.$inferInsert
export type ErrorEvent = typeof errorEvents.$inferSelect
export type NewErrorEvent = typeof errorEvents.$inferInsert
export type DeletionBatch = typeof deletionBatches.$inferSelect
export type NewDeletionBatch = typeof deletionBatches.$inferInsert
export type NewMilestone = typeof milestones.$inferInsert
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
export type IssueWatcher = typeof issueWatchers.$inferSelect
export type NewIssueWatcher = typeof issueWatchers.$inferInsert
export type EmailWhitelistEntry = typeof emailWhitelist.$inferSelect
export type NewEmailWhitelistEntry = typeof emailWhitelist.$inferInsert
