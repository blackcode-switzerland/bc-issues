import {
  pgTable,
  serial,
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
  avatar_url: text('avatar_url'),
  password_hash: varchar('password_hash', { length: 255 }),
  role: varchar('role', { length: 50 }).default('member').notNull(),
  last_login: timestamp('last_login', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 50 }).default('active'),
  owner_id: integer('owner_id').references(() => users.id, { onDelete: 'set null' }),
  priority: varchar('priority', { length: 10 }).default('P2'),
  visibility: varchar('visibility', { length: 20 }).default('team'),
  color: varchar('color', { length: 10 }).default('#3B82F6'),
  icon_url: text('icon_url'),
  banner_url: text('banner_url'),
  start_date: date('start_date'),
  end_date: date('end_date'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

export const milestones = pgTable(
  'milestones',
  {
    id: serial('id').primaryKey(),
    project_id: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    due_date: date('due_date'),
    status: varchar('status', { length: 50 }).default('active'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    projectIdx: index('idx_milestones_project').on(t.project_id),
  })
)

export const issues = pgTable(
  'issues',
  {
    id: serial('id').primaryKey(),
    project_id: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
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
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    projectIdx: index('idx_issues_project').on(t.project_id),
    statusIdx: index('idx_issues_status').on(t.status),
    assigneeIdx: index('idx_issues_assignee').on(t.assignee_id),
    milestoneIdx: index('idx_issues_milestone').on(t.milestone_id),
    priorityIdx: index('idx_issues_priority').on(t.priority),
    priorityCheck: check('issues_priority_check', sql`${t.priority} >= 1 AND ${t.priority} <= 5`),
  })
)

export const comments = pgTable(
  'comments',
  {
    id: serial('id').primaryKey(),
    issue_id: integer('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    user_id: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    content: text('content').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    issueIdx: index('idx_comments_issue').on(t.issue_id),
  })
)

export const attachments = pgTable(
  'attachments',
  {
    id: serial('id').primaryKey(),
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
    project_id: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 50 }).notNull(),
    color: varchar('color', { length: 7 }).default('#6b7280'),
    description: text('description'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    projectIdx: index('idx_labels_project').on(t.project_id),
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

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Milestone = typeof milestones.$inferSelect
export type Issue = typeof issues.$inferSelect
export type NewIssue = typeof issues.$inferInsert
export type Comment = typeof comments.$inferSelect
export type Attachment = typeof attachments.$inferSelect
export type Label = typeof labels.$inferSelect
export type ProjectMember = typeof projectMembers.$inferSelect
export type TransactionLogEntry = typeof transactionLog.$inferSelect
export type ApiToken = typeof apiTokens.$inferSelect
export type NewApiToken = typeof apiTokens.$inferInsert
