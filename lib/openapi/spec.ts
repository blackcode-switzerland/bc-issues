// Hand-authored OpenAPI 3.1 description of the Blackcode Issues HTTP API.
//
// Scope: every user-facing feature route, kept in sync with app/api/** and the
// bk CLI — issues, projects, tasks, comments, labels, members, attachments,
// activity, analytics, invitations, inbox, trash, project updates, account/me,
// tokens, undo, upload, users, super-admin and public auth. Only true internals
// are omitted (NextAuth handler, client-error beacon, and the /api/docs +
// /api/openapi.json discovery routes themselves). A parity test asserts this.
//
// Conventions baked in here mirror lib/api: every list returns
// { data, next_cursor, total? }; errors are { error, code, suggestion?, details? };
// auth is a `bk_live_…` bearer token. Enums are imported from lib/work-items so
// the valid status/priority values can never drift from the source of truth.
//
// Served as JSON at GET /api/openapi.json and rendered at GET /api/docs.

import {
  ISSUE_STATUS_VALUES,
  PROJECT_STATUS_VALUES,
  PROJECT_PRIORITIES,
  PROJECT_UPDATE_STATUS_VALUES,
} from '@/lib/work-items'

const ISSUE_PRIORITY_VALUES = [1, 2, 3, 4, 5]
const PROJECT_PRIORITY_VALUES = PROJECT_PRIORITIES.map((p) => p.value)

// ---- reusable response/parameter builders ---------------------------------

const errorRef = { $ref: '#/components/schemas/Error' }

function errors(...codes: Array<400 | 401 | 403 | 404 | 409 | 422>) {
  const out: Record<string, unknown> = {}
  const msg: Record<number, string> = {
    400: 'Bad request',
    401: 'Authentication required',
    403: 'Forbidden',
    404: 'Not found',
    409: 'Conflict',
    422: 'Unprocessable entity',
  }
  for (const c of codes) {
    out[String(c)] = {
      description: msg[c],
      content: { 'application/json': { schema: errorRef } },
    }
  }
  return out
}

function jsonObject(ref: string, description = 'Success') {
  return {
    description,
    content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } },
  }
}

// A { data: Item[], next_cursor, total? } list envelope response.
function jsonList(itemRef: string, description = 'A page of results') {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['data', 'next_cursor'],
          properties: {
            data: { type: 'array', items: { $ref: `#/components/schemas/${itemRef}` } },
            next_cursor: {
              type: ['integer', 'null'],
              description: 'Pass back as ?cursor= for the next page; null when there are no more rows.',
            },
            total: { type: 'integer', description: 'Total matching rows (included where cheap to compute).' },
          },
        },
      },
    },
  }
}

// Response for non-paginated lists that return every matching row in one shot
// plus a total count (e.g. issues): { data, total } with no next_cursor.
function jsonListTotal(itemRef: string, description = 'All matching rows') {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['data'],
          properties: {
            data: { type: 'array', items: { $ref: `#/components/schemas/${itemRef}` } },
            total: { type: 'integer', description: 'Total matching rows.' },
          },
        },
      },
    },
  }
}

// Inline response for the handful of action endpoints that return a small ad-hoc
// object (or a raw array) rather than an entity / list envelope.
function jsonShape(schema: Record<string, unknown>, description = 'Success') {
  return { description, content: { 'application/json': { schema } } }
}

const deletedResponse = {
  description: 'Deleted (soft-delete / moved to Trash where applicable)',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          deleted: { type: 'boolean', enum: [true] },
          mode: { type: 'string', enum: ['cascade', 'detach'], description: 'Only for resources with children.' },
        },
        required: ['deleted'],
      },
    },
  },
}

const wsParam = {
  name: 'ws',
  in: 'path',
  required: true,
  description: 'Workspace slug or numeric id.',
  schema: { type: 'string' },
}
const idParam = (name = 'id', description = 'Numeric id of the resource.') => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'integer' },
})
const cursorParam = {
  name: 'cursor',
  in: 'query',
  required: false,
  description: 'Keyset cursor from a previous response’s next_cursor.',
  schema: { type: 'integer' },
}
const limitParam = {
  name: 'limit',
  in: 'query',
  required: false,
  description: 'Page size (default 50, max 200).',
  schema: { type: 'integer', default: 50, maximum: 200, minimum: 1 },
}

// An entity schema that lists its notable fields but stays permissive
// (additionalProperties) so omitting a column never makes the spec wrong.
function entity(properties: Record<string, unknown>, description: string) {
  return { type: 'object', description, additionalProperties: true, properties }
}

export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Blackcode Issues API',
    version: '1.1.0',
    description:
      'AI-native issue tracker. Everything is workspace-scoped: resolve a workspace ' +
      '(slug or id) and operate under /api/workspaces/{ws}/…. Authenticate with a ' +
      '`bk_live_…` bearer token (create one in Settings → API Tokens or via `bk login`). ' +
      'Project/task/issue ids are the workspace #number shown in the app (unique per ' +
      'workspace) — address everything by it; the global db id is never exposed. ' +
      'Breaking changes are listed in docs/api-changelog.md. ' +
      'Lists return { data, total }; errors return { error, code, suggestion?, details? }. ' +
      'Call GET /api/meta first to discover the active workspace and the valid status/priority vocabulary. ' +
      'Rich-text fields (issue/project descriptions, comments, project updates) accept **Markdown or HTML** ' +
      'and are stored as sanitized HTML — send real newlines, not the literal characters "\\n". ' +
      'To embed a file/image: POST it to /api/upload (multipart, field "file") to get a { url }, then ' +
      'reference that url in any rich-text field as `![name](url)` for images or `[name](url)` for any ' +
      'other file. Uploaded urls are rendered inline automatically (image preview, video/audio player, ' +
      'or download card); external urls are left as plain links/images. Max file size 100MB.',
  },
  servers: [{ url: '/', description: 'Same origin' }],
  security: [{ bearerAuth: [] }],
  tags: [
    { name: 'Meta', description: 'Discovery: current user, context, vocabulary.' },
    { name: 'Account', description: 'The authenticated account: profile, workspaces, inbox, invitations, password.' },
    { name: 'Workspaces', description: 'Workspaces and membership.' },
    { name: 'Issues', description: 'Issues and their comments, labels, attachments, activity.' },
    { name: 'Projects', description: 'Projects and project members.' },
    { name: 'Tasks', description: 'Tasks.' },
    { name: 'Labels', description: 'Workspace labels.' },
    { name: 'Insights', description: 'Activity feed and analytics.' },
    { name: 'Tokens', description: 'API token management (session-only).' },
    { name: 'Trash', description: 'Soft-deleted resources: browse, restore, purge.' },
    { name: 'Storage', description: 'Workspace file storage: list uploaded files, review usage, delete orphans. Owner only.' },
    { name: 'System', description: 'Cross-cutting utilities: undo, upload, users, health.' },
    { name: 'Super admin', description: 'Platform administration. Requires a SUPER_ADMINS email.' },
    { name: 'Auth', description: 'Public authentication: register, password reset, CLI authorize.' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'bk_live_…',
        description: 'Send `Authorization: Bearer bk_live_…`.',
      },
    },
    schemas: {
      Error: entity(
        {
          error: { type: 'string', description: 'Human-readable message.' },
          code: { type: 'string', description: 'Machine-readable code, e.g. invalid_title, issue_not_found.' },
          suggestion: { type: 'string', description: 'Optional hint on how to fix it.' },
          details: { type: 'object', description: 'Optional structured context.' },
        },
        'Canonical error envelope returned by every route.'
      ),
      Me: entity(
        {
          id: { type: 'integer' },
          email: { type: 'string' },
          name: { type: ['string', 'null'] },
          avatar_url: { type: ['string', 'null'] },
          active_workspace_id: { type: ['integer', 'null'] },
          via: { type: 'string', enum: ['session', 'token'], description: 'How this request authenticated.' },
          is_super_admin: { type: 'boolean' },
        },
        'The authenticated user.'
      ),
      Meta: entity(
        {
          user: { $ref: '#/components/schemas/Me' },
          active_workspace: { type: ['object', 'null'], additionalProperties: true },
          vocabulary: {
            type: 'object',
            description: 'Valid enum values for issue/project fields.',
            additionalProperties: true,
          },
          labels: { type: 'array', items: { $ref: '#/components/schemas/Label' } },
          projects: { type: 'array', items: { $ref: '#/components/schemas/Project' } },
          members: { type: 'array', items: { $ref: '#/components/schemas/Member' } },
        },
        'Bootstrap context: who am I, which workspace, and the vocabulary + entities to ground on.'
      ),
      Workspace: entity(
        {
          id: { type: 'integer' },
          name: { type: 'string' },
          slug: { type: 'string' },
          member_role: { type: 'string', enum: ['owner', 'member'] },
        },
        'A workspace (tenant).'
      ),
      Member: entity(
        {
          user_id: { type: 'integer' },
          name: { type: ['string', 'null'] },
          email: { type: 'string' },
          avatar_url: { type: ['string', 'null'] },
          role: { type: 'string' },
        },
        'A workspace or project member.'
      ),
      Issue: entity(
        {
          id: { type: 'integer', description: 'The workspace #number shown in the app; address the issue by it.' },
          workspace_id: { type: 'integer' },
          project_id: { type: ['integer', 'null'], description: "Parent project's #number, or null." },
          task_id: { type: ['integer', 'null'], description: "Parent task's #number, or null." },
          title: { type: 'string' },
          description: { type: ['string', 'null'] },
          status: { type: 'string', enum: ISSUE_STATUS_VALUES },
          priority: { type: 'integer', enum: ISSUE_PRIORITY_VALUES, description: '1=Urgent…4=Low, 5=None.' },
          assignee_ids: { type: 'array', items: { type: 'integer' } },
          start_date: { type: ['string', 'null'], format: 'date' },
          due_date: { type: ['string', 'null'], format: 'date' },
          estimated_hours: { type: ['number', 'null'] },
          reporter_id: { type: ['integer', 'null'] },
          created_at: { type: 'string', format: 'date-time' },
        },
        'An issue.'
      ),
      CreateIssue: {
        type: 'object',
        required: ['title'],
        additionalProperties: false,
        properties: {
          title: { type: 'string', maxLength: 200 },
          description: { type: 'string', description: 'Markdown or HTML; stored as sanitized HTML. Use real newlines, not literal "\\n". Embed an uploaded file with ![name](url) (image) or [name](url) (any file) — see /api/upload.' },
          status: { type: 'string', enum: ISSUE_STATUS_VALUES },
          priority: { type: 'integer', enum: ISSUE_PRIORITY_VALUES },
          project_id: { type: ['integer', 'null'] },
          task_id: { type: ['integer', 'null'] },
          assignee_ids: { type: 'array', items: { type: 'integer' }, description: 'Must be workspace members.' },
          label_ids: { type: 'array', items: { type: 'integer' }, description: 'Existing label ids.' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Label names — existing are matched case-insensitively, unknown ones are created on the fly. Use this (not label_ids) to add or create labels by name.' },
          start_date: { type: ['string', 'null'], format: 'date' },
          due_date: { type: ['string', 'null'], format: 'date' },
          estimated_hours: { type: ['number', 'null'] },
        },
      },
      UpdateIssue: {
        type: 'object',
        description: 'Any subset of the create fields; send null to clear nullable fields.',
        additionalProperties: true,
        properties: {
          title: { type: 'string', maxLength: 200 },
          description: { type: ['string', 'null'] },
          status: { type: 'string', enum: ISSUE_STATUS_VALUES },
          priority: { type: 'integer', enum: ISSUE_PRIORITY_VALUES },
          project_id: { type: ['integer', 'null'] },
          task_id: { type: ['integer', 'null'] },
          assignee_ids: { type: 'array', items: { type: 'integer' } },
          start_date: { type: ['string', 'null'], format: 'date' },
          due_date: { type: ['string', 'null'], format: 'date' },
          estimated_hours: { type: ['number', 'null'] },
        },
      },
      Project: entity(
        {
          id: { type: 'integer' },
          workspace_id: { type: 'integer' },
          name: { type: 'string' },
          summary: { type: ['string', 'null'] },
          description: { type: ['string', 'null'] },
          status: { type: 'string', enum: PROJECT_STATUS_VALUES },
          priority: { type: ['string', 'null'], enum: [...PROJECT_PRIORITY_VALUES, null] },
          color: { type: ['string', 'null'] },
          icon: { type: ['string', 'null'] },
          lead_user_id: { type: ['integer', 'null'] },
          start_date: { type: ['string', 'null'], format: 'date' },
          due_date: { type: ['string', 'null'], format: 'date' },
        },
        'A project.'
      ),
      CreateProject: {
        type: 'object',
        required: ['name'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', maxLength: 100 },
          summary: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: PROJECT_STATUS_VALUES },
          priority: { type: 'string', enum: PROJECT_PRIORITY_VALUES },
          color: { type: 'string' },
          icon: { type: 'string' },
          lead_user_id: { type: 'integer' },
          start_date: { type: 'string', format: 'date' },
          due_date: { type: 'string', format: 'date' },
          member_ids: { type: 'array', items: { type: 'integer' } },
        },
      },
      Task: entity(
        {
          id: { type: 'integer' },
          workspace_id: { type: 'integer' },
          project_id: { type: ['integer', 'null'] },
          name: { type: 'string' },
          description: { type: ['string', 'null'] },
          due_date: { type: ['string', 'null'], format: 'date' },
          status: { type: ['string', 'null'] },
          lead_id: { type: ['integer', 'null'], description: 'User id of the task lead.' },
        },
        'A task (standalone or attached to a project).'
      ),
      CreateTask: {
        type: 'object',
        required: ['name'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', maxLength: 100 },
          description: { type: 'string' },
          project_id: { type: ['integer', 'null'] },
          due_date: { type: ['string', 'null'], format: 'date' },
          lead_user_id: { type: 'integer', description: 'User id of the task lead. Defaults to the creator.' },
        },
      },
      Comment: entity(
        {
          id: { type: 'integer' },
          parent_type: { type: 'string', enum: ['issue', 'task', 'project'] },
          parent_id: { type: 'integer', description: "The parent issue/task/project's #number (not the internal id)." },
          user_id: { type: 'integer' },
          content: { type: 'string' },
          parent_comment_id: { type: ['integer', 'null'] },
          created_at: { type: 'string', format: 'date-time' },
        },
        'A polymorphic comment.'
      ),
      CreateComment: {
        type: 'object',
        required: ['content'],
        additionalProperties: false,
        properties: {
          content: { type: 'string', description: 'Non-empty. Markdown or HTML; stored as sanitized HTML. Use real newlines, not literal "\\n". Embed an uploaded file with ![name](url) (image) or [name](url) (any file) — see /api/upload.' },
          parent_comment_id: { type: 'integer', description: 'Set to reply to another comment.' },
        },
      },
      Label: entity(
        {
          id: { type: 'integer' },
          workspace_id: { type: 'integer' },
          name: { type: 'string' },
          color: { type: 'string', description: '7-char hex, e.g. #5E6AD2.' },
        },
        'A workspace label.'
      ),
      Attachment: entity(
        {
          id: { type: 'integer' },
          issue_id: { type: 'integer', description: "The issue's #number (not the internal id)." },
          filename: { type: 'string' },
          file_url: { type: 'string' },
          file_size: { type: ['integer', 'null'] },
          mime_type: { type: ['string', 'null'] },
          uploaded_by: { type: 'integer' },
        },
        'An issue attachment.'
      ),
      WorkspaceAttachment: entity(
        {
          id: { type: 'integer' },
          issue_id: { type: 'integer', description: 'The issue #number (same as issue_seq; the internal id is never exposed).' },
          issue_seq: { type: ['integer', 'null'], description: 'The issue #number.' },
          issue_title: { type: ['string', 'null'] },
          filename: { type: 'string' },
          file_url: { type: 'string' },
          file_size: { type: ['integer', 'null'] },
          mime_type: { type: ['string', 'null'] },
          uploaded_by: { type: ['integer', 'null'] },
          uploader_name: { type: ['string', 'null'] },
          created_at: { type: 'string', format: 'date-time' },
        },
        'An attachment row with its issue and uploader (workspace-wide view).'
      ),
      StorageReference: entity(
        {
          type: { type: 'string', enum: ['issue', 'task', 'project', 'comment', 'project_update', 'attachment'] },
          id: { type: 'integer', description: 'Internal id of the referencing entity.' },
          seq: { type: ['integer', 'null'], description: 'The #number where one applies (issue/task/project).' },
          label: { type: ['string', 'null'], description: 'Title/name of the referencing entity, where available.' },
          trashed: { type: 'boolean', description: 'True if the referencing item is in the recycle bin (still restorable).' },
        },
        'One thing that references a stored file.'
      ),
      StorageFile: entity(
        {
          id: { type: 'integer', description: 'uploads.id — address deletes by this.' },
          url: { type: 'string' },
          filename: { type: 'string' },
          size: { type: ['integer', 'null'] },
          mime_type: { type: ['string', 'null'] },
          uploaded_by: { type: ['integer', 'null'] },
          uploader_name: { type: ['string', 'null'] },
          uploader_avatar: { type: ['string', 'null'] },
          created_at: { type: 'string', format: 'date-time' },
          reference_count: { type: 'integer', description: '0 = orphan, safe to delete.' },
          references: { type: 'array', items: { $ref: '#/components/schemas/StorageReference' } },
        },
        'A file in workspace storage with its live references.'
      ),
      ActivityEvent: entity(
        {
          id: { type: 'integer' },
          entity_type: { type: 'string' },
          entity_id: { type: 'integer' },
          action: { type: 'string' },
          actor_user_id: { type: ['integer', 'null'] },
          occurred_at: { type: 'string', format: 'date-time' },
        },
        'An event from the activity spine.'
      ),
      Analytics: entity({}, 'Analytics payload (see GET analytics for the shape per view).'),
      Token: entity(
        {
          id: { type: 'integer' },
          name: { type: 'string' },
          token_prefix: { type: 'string' },
          last_used_at: { type: ['string', 'null'], format: 'date-time' },
          expires_at: { type: ['string', 'null'], format: 'date-time' },
        },
        'An API token (the plaintext secret is only returned once, at creation).'
      ),
      Invitation: entity(
        {
          id: { type: 'integer' },
          workspace_id: { type: 'integer' },
          email: { type: 'string' },
          role: { type: 'string', enum: ['owner', 'member'] },
          status: { type: 'string', enum: ['pending', 'accepted', 'declined', 'revoked'] },
          token: { type: ['string', 'null'], description: 'Opaque acceptance token (only on outbound invites you can act on).' },
          invited_by: { type: ['integer', 'null'] },
          created_at: { type: 'string', format: 'date-time' },
        },
        'A workspace invitation.'
      ),
      Candidate: entity(
        {
          email: { type: 'string' },
          name: { type: ['string', 'null'] },
          avatar_url: { type: ['string', 'null'] },
          reason: { type: ['string', 'null'], description: 'Why this person is suggested (e.g. shared workspace).' },
        },
        'A suggested person to invite into the workspace.'
      ),
      InboxMessage: entity(
        {
          id: { type: 'integer' },
          user_id: { type: 'integer' },
          workspace_id: { type: ['integer', 'null'] },
          type: { type: 'string', description: 'Notification kind, e.g. mention, assignment, comment.' },
          title: { type: ['string', 'null'] },
          body: { type: ['string', 'null'] },
          read_at: { type: ['string', 'null'], format: 'date-time' },
          archived_at: { type: ['string', 'null'], format: 'date-time' },
          created_at: { type: 'string', format: 'date-time' },
        },
        'An inbox notification.'
      ),
      ProjectUpdate: entity(
        {
          id: { type: 'integer' },
          project_id: { type: 'integer', description: "The project's #number (not the internal id)." },
          author_id: { type: 'integer' },
          status: { type: 'string', enum: PROJECT_UPDATE_STATUS_VALUES, description: 'Project health at the time of the update.' },
          body: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
        'A project health update.'
      ),
      TrashItem: entity(
        {
          type: { type: 'string', enum: ['issue', 'project', 'task'] },
          id: { type: 'integer' },
          title: { type: ['string', 'null'] },
          deleted_at: { type: ['string', 'null'], format: 'date-time' },
          batch_id: { type: ['string', 'null'], description: 'Groups items deleted together; pass to restore/purge.' },
        },
        'A soft-deleted resource living in the Trash.'
      ),
      WhitelistEntry: entity(
        {
          id: { type: 'integer' },
          type: { type: 'string', enum: ['email', 'domain'] },
          value: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
        'An email/domain whitelist entry gating sign-up.'
      ),
      ErrorEvent: entity(
        {
          id: { type: 'integer' },
          level: { type: 'string', enum: ['error', 'warn', 'info'] },
          status: { type: ['integer', 'null'], description: 'HTTP status associated with the event, if any.' },
          message: { type: 'string' },
          stack: { type: ['string', 'null'] },
          resolved: { type: 'boolean' },
          occurred_at: { type: 'string', format: 'date-time' },
        },
        'A captured server/client error event.'
      ),
      User: entity(
        {
          id: { type: 'integer' },
          name: { type: ['string', 'null'] },
          email: { type: 'string' },
          avatar_url: { type: ['string', 'null'] },
        },
        'A user visible to you (a workspace-mate).'
      ),
    },
  },
  paths: {
    '/api/meta': {
      get: {
        tags: ['Meta'],
        operationId: 'getMeta',
        summary: 'Bootstrap context + vocabulary',
        description: 'The first call an agent should make: current user, active workspace, valid enum vocabulary, and the workspace’s labels/projects/members.',
        responses: { '200': jsonObject('Meta', 'Context'), ...errors(401) },
      },
    },
    '/api/me': {
      get: {
        tags: ['Meta'],
        operationId: 'getMe',
        summary: 'Current user',
        responses: { '200': jsonObject('Me'), ...errors(401) },
      },
      patch: {
        tags: ['Account'], operationId: 'updateMe', summary: 'Update my profile',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, tagline: { type: 'string' }, avatar_url: { type: 'string' } } } } } },
        responses: { '200': jsonObject('Me'), ...errors(400, 401) },
      },
      delete: {
        tags: ['Account'], operationId: 'deleteMe', summary: 'Delete my account',
        parameters: [{ name: 'check', in: 'query', schema: { type: 'string' }, description: 'check=1 performs a dry-run that reports what would be deleted.' }],
        responses: { '200': jsonShape({ type: 'object', additionalProperties: true }, 'Deleted (or dry-run report)'), ...errors(400, 401) },
      },
    },
    '/api/me/active-workspace': {
      post: {
        tags: ['Account'], operationId: 'setActiveWorkspace', summary: 'Set my active workspace',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['workspace_id'], properties: { workspace_id: { type: 'integer' } } } } } },
        responses: { '200': jsonShape({ type: 'object', additionalProperties: true }, 'Updated'), ...errors(400, 401, 404) },
      },
    },
    '/api/me/inbox': {
      get: {
        tags: ['Account'], operationId: 'getInbox', summary: 'My inbox notifications',
        parameters: [
          { name: 'unread', in: 'query', schema: { type: 'boolean' }, description: 'Only unread messages.' },
          { name: 'count_only', in: 'query', schema: { type: 'boolean' }, description: 'Return just a count.' },
          { name: 'include_archived', in: 'query', schema: { type: 'boolean' } },
          { name: 'archived_only', in: 'query', schema: { type: 'boolean' } },
          { name: 'workspace_id', in: 'query', schema: { type: 'integer' } },
          { name: 'type', in: 'query', schema: { type: 'string' }, description: 'Filter by notification type.' },
          limitParam,
        ],
        responses: { '200': jsonList('InboxMessage'), ...errors(400, 401) },
      },
    },
    '/api/me/inbox/mark-read': {
      post: {
        tags: ['Account'], operationId: 'inboxMarkRead', summary: 'Mark inbox messages read',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'integer' } }, all: { type: 'boolean', description: 'Mark every message read.' } } } } } },
        responses: { '200': jsonShape({ type: 'object', additionalProperties: true }, 'Updated'), ...errors(400, 401) },
      },
    },
    '/api/me/inbox/archive': {
      post: {
        tags: ['Account'], operationId: 'inboxArchive', summary: 'Archive inbox messages',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'integer' } } } } } } },
        responses: { '200': jsonShape({ type: 'object', additionalProperties: true }, 'Archived'), ...errors(400, 401) },
      },
    },
    '/api/me/inbox/unarchive': {
      post: {
        tags: ['Account'], operationId: 'inboxUnarchive', summary: 'Unarchive inbox messages',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'integer' } } } } } } },
        responses: { '200': jsonShape({ type: 'object', additionalProperties: true }, 'Unarchived'), ...errors(400, 401) },
      },
    },
    '/api/me/pending-invitations': {
      get: { tags: ['Account'], operationId: 'listPendingInvitations', summary: 'Invitations awaiting my response', responses: { '200': jsonList('Invitation'), ...errors(401) } },
    },
    '/api/me/password/request-otp': {
      post: {
        tags: ['Account'], operationId: 'requestPasswordOtp', summary: 'Email myself a password-change OTP',
        requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: false } } } },
        responses: { '200': jsonShape({ type: 'object', additionalProperties: true }, 'OTP sent'), ...errors(401) },
      },
    },
    '/api/me/password/confirm': {
      post: {
        tags: ['Account'], operationId: 'confirmPasswordChange', summary: 'Confirm a password change with an OTP',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['otp', 'new_password'], properties: { otp: { type: 'string' }, new_password: { type: 'string' } } } } } },
        responses: { '200': jsonShape({ type: 'object', additionalProperties: true }, 'Password changed'), ...errors(400, 401) },
      },
    },
    '/api/workspaces': {
      get: {
        tags: ['Workspaces'],
        operationId: 'listWorkspaces',
        summary: 'List my workspaces',
        responses: { '200': jsonList('Workspace'), ...errors(401) },
      },
      post: {
        tags: ['Workspaces'],
        operationId: 'createWorkspace',
        summary: 'Create a workspace',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } },
        },
        responses: { '201': jsonObject('Workspace', 'Created'), ...errors(400, 401) },
      },
    },
    '/api/workspaces/{ws}': {
      parameters: [wsParam],
      get: { tags: ['Workspaces'], operationId: 'getWorkspace', summary: 'Workspace detail', responses: { '200': jsonObject('Workspace'), ...errors(401, 404) } },
      patch: {
        tags: ['Workspaces'], operationId: 'updateWorkspace', summary: 'Update workspace (owner)',
        requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
        responses: { '200': jsonObject('Workspace'), ...errors(400, 401, 403, 404) },
      },
      delete: { tags: ['Workspaces'], operationId: 'deleteWorkspace', summary: 'Delete workspace (owner)', responses: { '200': deletedResponse, ...errors(401, 403, 404) } },
    },
    '/api/invitations/accept': {
      post: {
        tags: ['Workspaces'], operationId: 'acceptInvitation', summary: 'Accept a workspace invitation',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['token'], properties: { token: { type: 'string' } } } } } },
        responses: { '200': jsonShape({ type: 'object', additionalProperties: true }, 'Accepted'), ...errors(400, 401, 404) },
      },
    },
    '/api/invitations/decline': {
      post: {
        tags: ['Workspaces'], operationId: 'declineInvitation', summary: 'Decline a workspace invitation',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['token'], properties: { token: { type: 'string' } } } } } },
        responses: { '200': jsonShape({ type: 'object', additionalProperties: true }, 'Declined'), ...errors(400, 401, 404) },
      },
    },
    '/api/workspaces/{ws}/members': {
      parameters: [wsParam],
      get: { tags: ['Workspaces'], operationId: 'listMembers', summary: 'List workspace members', responses: { '200': jsonList('Member'), ...errors(401, 404) } },
    },
    '/api/workspaces/{ws}/members/{userId}': {
      parameters: [wsParam, idParam('userId', 'User id.')],
      delete: { tags: ['Workspaces'], operationId: 'removeMember', summary: 'Remove a member (owner)', responses: { '200': deletedResponse, ...errors(400, 401, 403, 404) } },
    },
    '/api/workspaces/{ws}/leave': {
      parameters: [wsParam],
      post: {
        tags: ['Workspaces'], operationId: 'leaveWorkspace', summary: 'Leave a workspace',
        requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: false } } } },
        responses: { '200': jsonShape({ type: 'object', additionalProperties: true }, 'Left'), ...errors(400, 401, 403, 404) },
      },
    },
    '/api/workspaces/{ws}/transfer': {
      parameters: [wsParam],
      post: {
        tags: ['Workspaces'], operationId: 'transferWorkspace', summary: 'Transfer ownership (owner)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['user_id'], properties: { user_id: { type: 'integer' } } } } } },
        responses: { '200': jsonShape({ type: 'object', additionalProperties: true }, 'Transferred'), ...errors(400, 401, 403, 404) },
      },
    },
    '/api/workspaces/{ws}/invitations': {
      parameters: [wsParam],
      get: {
        tags: ['Workspaces'], operationId: 'listInvitations', summary: 'List workspace invitations',
        parameters: [{ name: 'all', in: 'query', schema: { type: 'boolean' }, description: 'Include non-pending invitations.' }],
        responses: { '200': jsonList('Invitation'), ...errors(401, 403, 404) },
      },
      post: {
        tags: ['Workspaces'], operationId: 'createInvitation', summary: 'Invite someone to the workspace',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string' }, role: { type: 'string', enum: ['owner', 'member'], default: 'member' } } } } } },
        responses: { '201': jsonObject('Invitation', 'Invited'), ...errors(400, 401, 403, 404, 409) },
      },
    },
    '/api/workspaces/{ws}/invitations/{id}': {
      parameters: [wsParam, idParam('id', 'Invitation id.')],
      delete: { tags: ['Workspaces'], operationId: 'revokeInvitation', summary: 'Revoke an invitation', responses: { '200': deletedResponse, ...errors(401, 403, 404) } },
    },
    '/api/workspaces/{ws}/invite-candidates': {
      parameters: [wsParam],
      get: { tags: ['Workspaces'], operationId: 'listInviteCandidates', summary: 'Suggested people to invite', responses: { '200': jsonList('Candidate'), ...errors(401, 403, 404) } },
    },
    '/api/workspaces/{ws}/issues': {
      parameters: [wsParam],
      get: {
        tags: ['Issues'], operationId: 'listIssues', summary: 'List issues',
        parameters: [
          { name: 'project_id', in: 'query', schema: { type: 'string' }, description: 'Filter by project; "null" for none.' },
          { name: 'task_id', in: 'query', schema: { type: 'string' }, description: 'Filter by task; "null" for none.' },
          { name: 'assignee_id', in: 'query', schema: { type: 'string' }, description: 'Single assignee, or "null" for unassigned.' },
          { name: 'assignee_ids', in: 'query', schema: { type: 'array', items: { type: 'integer' } }, style: 'form', explode: true, description: 'Repeatable multi-assignee filter.' },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ISSUE_STATUS_VALUES } },
          { name: 'priority', in: 'query', schema: { type: 'integer', enum: ISSUE_PRIORITY_VALUES } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': jsonListTotal('Issue', 'All matching issues (not paginated)'), ...errors(400, 401, 404) },
      },
      post: {
        tags: ['Issues'], operationId: 'createIssue', summary: 'Create an issue',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateIssue' } } } },
        responses: { '201': jsonObject('Issue', 'Created'), ...errors(400, 401, 404) },
      },
    },
    '/api/workspaces/{ws}/issues/reorder': {
      parameters: [wsParam],
      patch: {
        tags: ['Issues'], operationId: 'reorderIssues', summary: 'Reorder issues (drag-and-drop display order)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'integer' }, description: 'Issue ids in the desired display order.' } } } } } },
        responses: { '200': jsonShape({ type: 'object', additionalProperties: true }, 'Reordered'), ...errors(400, 401, 404) },
      },
    },
    '/api/workspaces/{ws}/issues/{id}': {
      parameters: [wsParam, idParam()],
      get: { tags: ['Issues'], operationId: 'getIssue', summary: 'Issue detail', responses: { '200': jsonObject('Issue'), ...errors(400, 401, 404) } },
      patch: {
        tags: ['Issues'], operationId: 'updateIssue', summary: 'Update an issue',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateIssue' } } } },
        responses: { '200': jsonObject('Issue'), ...errors(400, 401, 404) },
      },
      delete: { tags: ['Issues'], operationId: 'deleteIssue', summary: 'Move issue to Trash', responses: { '200': deletedResponse, ...errors(400, 401, 404) } },
    },
    '/api/workspaces/{ws}/issues/{id}/comments': {
      parameters: [wsParam, idParam()],
      get: { tags: ['Issues'], operationId: 'listIssueComments', summary: 'List comments', responses: { '200': jsonList('Comment'), ...errors(401, 404) } },
      post: {
        tags: ['Issues'], operationId: 'createIssueComment', summary: 'Add a comment',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateComment' } } } },
        responses: { '201': jsonObject('Comment', 'Created'), ...errors(400, 401, 404) },
      },
    },
    '/api/workspaces/{ws}/issues/{id}/labels': {
      parameters: [wsParam, idParam()],
      get: { tags: ['Issues'], operationId: 'listIssueLabels', summary: 'List labels on an issue', responses: { '200': jsonList('Label'), ...errors(401, 404) } },
      post: {
        tags: ['Issues'], operationId: 'attachIssueLabel', summary: 'Attach a label (by id, or by name — created on the fly)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', description: 'Provide label_id (existing) OR name (existing, matched case-insensitively, else created).', properties: { label_id: { type: 'integer' }, name: { type: 'string' } } } } } },
        responses: { '200': jsonShape({ type: 'object', required: ['attached'], properties: { attached: { type: 'boolean' } } }, 'Attached'), ...errors(400, 401, 404) },
      },
    },
    '/api/workspaces/{ws}/issues/{id}/labels/{lid}': {
      parameters: [wsParam, idParam(), idParam('lid', 'Label id.')],
      delete: { tags: ['Issues'], operationId: 'detachIssueLabel', summary: 'Detach a label', responses: { '200': deletedResponse, ...errors(401, 404) } },
    },
    '/api/workspaces/{ws}/issues/{id}/attachments': {
      parameters: [wsParam, idParam()],
      get: { tags: ['Issues'], operationId: 'listIssueAttachments', summary: 'List attachments', responses: { '200': jsonList('Attachment'), ...errors(401, 404) } },
      post: {
        tags: ['Issues'], operationId: 'createIssueAttachment', summary: 'Attach a file (upload via /api/upload first)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['filename', 'file_url'], properties: { filename: { type: 'string' }, file_url: { type: 'string' }, file_size: { type: 'integer' }, mime_type: { type: 'string' } } } } } },
        responses: { '201': jsonObject('Attachment', 'Attached'), ...errors(400, 401, 404) },
      },
    },
    '/api/workspaces/{ws}/issues/{id}/attachments/{attachmentId}': {
      parameters: [wsParam, idParam(), idParam('attachmentId', 'Attachment id.')],
      delete: { tags: ['Issues'], operationId: 'deleteIssueAttachment', summary: 'Remove an attachment', responses: { '200': deletedResponse, ...errors(400, 401, 404) } },
    },
    '/api/workspaces/{ws}/issues/{id}/activity': {
      parameters: [wsParam, idParam()],
      get: { tags: ['Issues'], operationId: 'getIssueActivity', summary: 'Activity feed for an issue', responses: { '200': jsonList('ActivityEvent'), ...errors(401, 404) } },
    },
    '/api/workspaces/{ws}/issues/{id}/watch': {
      parameters: [wsParam, idParam()],
      get: { tags: ['Issues'], operationId: 'getIssueWatchState', summary: 'Am I watching this issue?', responses: { '200': jsonShape({ type: 'object', required: ['watching'], properties: { watching: { type: 'boolean' } } }, 'Watch state'), ...errors(401, 404) } },
      post: { tags: ['Issues'], operationId: 'watchIssue', summary: 'Watch an issue', responses: { '200': jsonShape({ type: 'object', required: ['watching'], properties: { watching: { type: 'boolean' } } }, 'Now watching'), ...errors(401, 404) } },
      delete: { tags: ['Issues'], operationId: 'unwatchIssue', summary: 'Unwatch an issue', responses: { '200': jsonShape({ type: 'object', required: ['watching'], properties: { watching: { type: 'boolean' } } }, 'No longer watching'), ...errors(401, 404) } },
    },
    '/api/workspaces/{ws}/attachments': {
      parameters: [wsParam],
      get: { tags: ['Storage'], operationId: 'listWorkspaceAttachments', summary: 'List all attachment rows in the workspace (owner only)', responses: { '200': jsonList('WorkspaceAttachment'), ...errors(401, 403, 404) } },
    },
    '/api/workspaces/{ws}/storage': {
      parameters: [wsParam],
      get: {
        tags: ['Storage'],
        operationId: 'listStorage',
        summary: 'List uploaded files with references + usage (owner only)',
        description:
          'Every file uploaded into the workspace, each with the live list of things that reference it (issue/task/project/comment/project-update bodies and attachment rows, including items in the recycle bin). A file with reference_count = 0 is an orphan and can be deleted. Also returns total usage_bytes and the workspace storage limit (limit_bytes, null = unlimited).',
        responses: {
          '200': jsonShape(
            {
              type: 'object',
              required: ['data', 'next_cursor', 'total', 'usage_bytes', 'limit_bytes'],
              properties: {
                data: { type: 'array', items: { $ref: '#/components/schemas/StorageFile' } },
                next_cursor: { type: ['integer', 'null'] },
                total: { type: 'integer' },
                usage_bytes: { type: 'integer', description: 'Sum of all recorded file sizes.' },
                limit_bytes: { type: ['integer', 'null'], description: 'Storage quota in bytes; null = unlimited (no enforcement yet).' },
              },
            },
            'Files, references, and usage'
          ),
          ...errors(401, 403, 404),
        },
      },
    },
    '/api/workspaces/{ws}/storage/{id}': {
      parameters: [wsParam, idParam('id', 'Numeric id of the stored file (uploads.id).')],
      delete: {
        tags: ['Storage'],
        operationId: 'deleteStorageFile',
        summary: 'Permanently delete an orphaned file (owner only)',
        description:
          'Deletes the underlying bytes from storage and removes the ledger row. Gated by a live, system-wide reference scan: if anything still references the file (including trashed items), the request is refused with 409 file_in_use. Irreversible on success.',
        responses: { '200': deletedResponse, ...errors(400, 401, 403, 404, 409) },
      },
    },
    '/api/workspaces/{ws}/projects': {
      parameters: [wsParam],
      get: {
        tags: ['Projects'], operationId: 'listProjects', summary: 'List projects',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: PROJECT_STATUS_VALUES } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': jsonList('Project'), ...errors(401, 404) },
      },
      post: {
        tags: ['Projects'], operationId: 'createProject', summary: 'Create a project',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateProject' } } } },
        responses: { '201': jsonObject('Project', 'Created'), ...errors(400, 401, 404) },
      },
    },
    '/api/workspaces/{ws}/projects/reorder': {
      parameters: [wsParam],
      patch: {
        tags: ['Projects'], operationId: 'reorderProjects', summary: 'Reorder projects (drag-and-drop display order)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'integer' }, description: 'Project ids in the desired display order.' } } } } } },
        responses: { '200': jsonShape({ type: 'object', additionalProperties: true }, 'Reordered'), ...errors(400, 401, 404) },
      },
    },
    '/api/workspaces/{ws}/projects/{id}': {
      parameters: [wsParam, idParam()],
      get: {
        tags: ['Projects'], operationId: 'getProject', summary: 'Project detail (+ members)',
        parameters: [{ name: 'preview', in: 'query', schema: { type: 'string' }, description: 'preview=1 returns child counts for the delete dialog instead.' }],
        responses: { '200': jsonObject('Project'), ...errors(400, 401, 404) },
      },
      patch: {
        tags: ['Projects'], operationId: 'updateProject', summary: 'Update a project (also member_ids/label_ids)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
        responses: { '200': jsonObject('Project'), ...errors(400, 401, 404) },
      },
      delete: {
        tags: ['Projects'], operationId: 'deleteProject', summary: 'Move project to Trash',
        parameters: [{ name: 'mode', in: 'query', schema: { type: 'string', enum: ['cascade', 'detach'], default: 'detach' } }],
        responses: { '200': deletedResponse, ...errors(400, 401, 404) },
      },
    },
    '/api/workspaces/{ws}/projects/{id}/members': {
      parameters: [wsParam, idParam()],
      get: { tags: ['Projects'], operationId: 'listProjectMembers', summary: 'List project members', responses: { '200': jsonList('Member'), ...errors(401, 404) } },
      post: {
        tags: ['Projects'], operationId: 'addProjectMember', summary: 'Add a project member (owner/admin)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string' }, role: { type: 'string', enum: ['owner', 'admin', 'member', 'viewer'], default: 'member' } } } } } },
        responses: { '201': jsonObject('Member', 'Added'), ...errors(400, 401, 403, 404) },
      },
      delete: {
        tags: ['Projects'], operationId: 'removeProjectMember', summary: 'Remove a project member (owner/admin)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['user_id'], properties: { user_id: { type: 'integer' } } } } } },
        responses: { '200': deletedResponse, ...errors(400, 401, 403, 404) },
      },
    },
    '/api/workspaces/{ws}/projects/{id}/comments': {
      parameters: [wsParam, idParam()],
      get: { tags: ['Projects'], operationId: 'listProjectComments', summary: 'List project comments', responses: { '200': jsonList('Comment'), ...errors(401, 404) } },
      post: {
        tags: ['Projects'], operationId: 'createProjectComment', summary: 'Add a project comment',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateComment' } } } },
        responses: { '201': jsonObject('Comment', 'Created'), ...errors(400, 401, 404) },
      },
    },
    '/api/workspaces/{ws}/projects/{id}/updates': {
      parameters: [wsParam, idParam()],
      get: { tags: ['Projects'], operationId: 'listProjectUpdates', summary: 'List project health updates', responses: { '200': jsonList('ProjectUpdate'), ...errors(401, 404) } },
      post: {
        tags: ['Projects'], operationId: 'createProjectUpdate', summary: 'Post a project health update',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status', 'body'], properties: { status: { type: 'string', enum: PROJECT_UPDATE_STATUS_VALUES }, body: { type: 'string' } } } } } },
        responses: { '201': jsonObject('ProjectUpdate', 'Created'), ...errors(400, 401, 404) },
      },
    },
    '/api/workspaces/{ws}/projects/{id}/updates/{updateId}': {
      parameters: [wsParam, idParam(), idParam('updateId', 'Project update id.')],
      delete: { tags: ['Projects'], operationId: 'deleteProjectUpdate', summary: 'Delete a project update (author)', responses: { '200': deletedResponse, ...errors(401, 403, 404) } },
    },
    '/api/workspaces/{ws}/tasks': {
      parameters: [wsParam],
      get: {
        tags: ['Tasks'], operationId: 'listTasks', summary: 'List tasks',
        parameters: [
          { name: 'project_id', in: 'query', schema: { type: 'string' }, description: 'Filter by project; "null" for standalone.' },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': jsonList('Task'), ...errors(400, 401, 404) },
      },
      post: {
        tags: ['Tasks'], operationId: 'createTask', summary: 'Create a task',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateTask' } } } },
        responses: { '201': jsonObject('Task', 'Created'), ...errors(400, 401, 404) },
      },
    },
    '/api/workspaces/{ws}/tasks/{id}': {
      parameters: [wsParam, idParam()],
      get: { tags: ['Tasks'], operationId: 'getTask', summary: 'Task detail', responses: { '200': jsonObject('Task'), ...errors(400, 401, 404) } },
      patch: {
        tags: ['Tasks'], operationId: 'updateTask', summary: 'Update a task',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
        responses: { '200': jsonObject('Task'), ...errors(400, 401, 404) },
      },
      delete: {
        tags: ['Tasks'], operationId: 'deleteTask', summary: 'Move task to Trash',
        parameters: [{ name: 'mode', in: 'query', schema: { type: 'string', enum: ['cascade', 'detach'], default: 'detach' } }],
        responses: { '200': deletedResponse, ...errors(400, 401, 404) },
      },
    },
    '/api/workspaces/{ws}/tasks/{id}/comments': {
      parameters: [wsParam, idParam()],
      get: { tags: ['Tasks'], operationId: 'listTaskComments', summary: 'List task comments', responses: { '200': jsonList('Comment'), ...errors(401, 404) } },
      post: {
        tags: ['Tasks'], operationId: 'createTaskComment', summary: 'Add a task comment',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateComment' } } } },
        responses: { '201': jsonObject('Comment', 'Created'), ...errors(400, 401, 404) },
      },
    },
    '/api/workspaces/{ws}/labels': {
      parameters: [wsParam],
      get: { tags: ['Labels'], operationId: 'listLabels', summary: 'List labels', responses: { '200': jsonList('Label'), ...errors(401, 404) } },
      post: {
        tags: ['Labels'], operationId: 'createLabel', summary: 'Create a label',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 50 }, color: { type: 'string', description: '7-char hex.' }, description: { type: 'string' } } } } } },
        responses: { '201': jsonObject('Label', 'Created'), ...errors(400, 401, 404, 409) },
      },
    },
    '/api/workspaces/{ws}/labels/{id}': {
      parameters: [wsParam, idParam()],
      get: {
        tags: ['Labels'], operationId: 'getLabel', summary: 'Label detail',
        responses: { '200': jsonObject('Label'), ...errors(400, 401, 404) },
      },
      patch: {
        tags: ['Labels'], operationId: 'updateLabel', summary: 'Update a label',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
        responses: { '200': jsonObject('Label'), ...errors(400, 401, 404) },
      },
      delete: { tags: ['Labels'], operationId: 'deleteLabel', summary: 'Delete a label', responses: { '200': deletedResponse, ...errors(401, 404) } },
    },
    '/api/workspaces/{ws}/comments/{id}': {
      parameters: [wsParam, idParam('id', 'Comment id.')],
      patch: {
        tags: ['Issues'], operationId: 'updateComment', summary: 'Edit a comment (author)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['content'], properties: { content: { type: 'string' } } } } } },
        responses: { '200': jsonObject('Comment'), ...errors(400, 401, 403, 404) },
      },
      delete: { tags: ['Issues'], operationId: 'deleteComment', summary: 'Delete a comment (author)', description: 'Permanently deletes the comment (and reply). Any files it embedded are automatically removed from storage if nothing else references them (same live system-wide scan as the Storage delete; trashed items still count as references).', responses: { '200': deletedResponse, ...errors(401, 403, 404) } },
    },
    '/api/workspaces/{ws}/activity': {
      parameters: [wsParam],
      get: {
        tags: ['Insights'], operationId: 'getActivity', summary: 'Workspace activity feed',
        parameters: [
          { name: 'entity_type', in: 'query', schema: { type: 'string' }, description: 'CSV of entity types.' },
          { name: 'action', in: 'query', schema: { type: 'string' }, description: 'CSV of actions.' },
          { name: 'actor', in: 'query', schema: { type: 'string' }, description: 'CSV of actor user ids.' },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          limitParam, cursorParam,
        ],
        responses: { '200': jsonList('ActivityEvent'), ...errors(400, 401, 404) },
      },
    },
    '/api/workspaces/{ws}/analytics': {
      parameters: [wsParam],
      get: {
        tags: ['Insights'], operationId: 'getAnalytics', summary: 'Workspace analytics',
        parameters: [
          { name: 'view', in: 'query', schema: { type: 'string', enum: ['workspace', 'project', 'task', 'member'] } },
          { name: 'id', in: 'query', schema: { type: 'integer' }, description: 'Target id (required for non-workspace views).' },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'interval', in: 'query', schema: { type: 'string', enum: ['day', 'week'], default: 'day' } },
        ],
        responses: { '200': jsonObject('Analytics'), ...errors(400, 401, 404) },
      },
    },
    '/api/tokens': {
      get: { tags: ['Tokens'], operationId: 'listTokens', summary: 'List API tokens (session-only)', responses: { '200': jsonShape({ type: 'array', items: { $ref: '#/components/schemas/Token' } }, 'Your API tokens'), ...errors(401) } },
      post: {
        tags: ['Tokens'], operationId: 'createToken', summary: 'Mint an API token (session-only)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 100 }, expires_at: { type: ['string', 'null'], format: 'date-time' } } } } } },
        responses: { '201': jsonObject('Token', 'Created — includes the one-time plaintext secret'), ...errors(400, 401) },
      },
    },
    '/api/tokens/{id}': {
      parameters: [idParam('id', 'Token id.')],
      delete: { tags: ['Tokens'], operationId: 'revokeToken', summary: 'Revoke an API token (session-only)', responses: { '200': deletedResponse, ...errors(400, 401, 404) } },
    },
    '/api/workspaces/{ws}/trash': {
      parameters: [wsParam],
      get: {
        tags: ['Trash'], operationId: 'listTrash', summary: 'Browse the Trash',
        parameters: [{ name: 'type', in: 'query', schema: { type: 'string', enum: ['issue', 'project', 'task'] }, description: 'Filter to one resource type.' }],
        responses: { '200': jsonList('TrashItem'), ...errors(400, 401, 404) },
      },
    },
    '/api/workspaces/{ws}/trash/restore': {
      parameters: [wsParam],
      post: {
        tags: ['Trash'], operationId: 'restoreFromTrash', summary: 'Restore items from the Trash',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true, properties: {
          items: { type: 'array', items: { type: 'object', required: ['type', 'id'], properties: { type: { type: 'string', enum: ['issue', 'project', 'task'] }, id: { type: 'integer' } } } },
          batch_id: { type: 'string', description: 'Restore an entire delete batch at once.' },
          dry_run: { type: 'boolean', description: 'Report conflicts without restoring.' },
          resolutions: { type: 'object', additionalProperties: true, description: 'How to resolve conflicts (e.g. relink/detach).' },
        } } } } },
        responses: { '200': jsonShape({ type: 'object', additionalProperties: true }, 'Restored (or dry-run report)'), ...errors(400, 401, 404, 409) },
      },
    },
    '/api/workspaces/{ws}/trash/purge': {
      parameters: [wsParam],
      delete: {
        tags: ['Trash'], operationId: 'purgeTrash', summary: 'Permanently delete trashed items (owner)', description: 'Permanently deletes one or more trashed items (or a whole batch). Any files embedded in the deleted content are automatically removed from storage once nothing else references them (including items still in the recycle bin). Irreversible.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true, properties: {
          items: { type: 'array', items: { type: 'object', required: ['type', 'id'], properties: { type: { type: 'string', enum: ['issue', 'project', 'task'] }, id: { type: 'integer' } } } },
          batch_id: { type: 'string' },
        } } } } },
        responses: { '200': deletedResponse, ...errors(400, 401, 403, 404) },
      },
    },
    '/api/workspaces/{ws}/trash/empty': {
      parameters: [wsParam],
      post: {
        tags: ['Trash'], operationId: 'emptyTrash', summary: 'Empty the Trash entirely (owner)', description: 'Permanently deletes everything in the workspace recycle bin. Any files embedded in the deleted content are automatically removed from storage once nothing else references them. Irreversible.',
        requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: false } } } },
        responses: { '200': jsonShape({ type: 'object', additionalProperties: true }, 'Emptied'), ...errors(401, 403, 404) },
      },
    },
    '/api/undo': {
      get: {
        tags: ['System'], operationId: 'listUndoLog', summary: 'Recent undoable transaction log',
        responses: { '200': jsonShape({ type: 'array', items: { type: 'object', additionalProperties: true } }, 'Recent transactions'), ...errors(401) },
      },
      post: {
        tags: ['System'], operationId: 'undo', summary: 'Undo the most recent operation(s)',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 10, description: 'How many operations to undo (default 1).' } } } } } },
        responses: { '200': jsonShape({ type: 'object', additionalProperties: true, properties: { success: { type: 'boolean' }, undone_count: { type: 'integer' }, operations: { type: 'array', items: { type: 'object', additionalProperties: true } } } }, 'Undone'), ...errors(400, 401) },
      },
    },
    '/api/upload': {
      get: { tags: ['System'], operationId: 'getUploadInfo', summary: 'Upload constraints/info', responses: { '200': jsonShape({ type: 'object', additionalProperties: true }, 'Upload info'), ...errors(401) } },
      post: {
        tags: ['System'], operationId: 'upload', summary: 'Upload a file (then embed its url in a description/comment)',
        description:
          'Multipart upload (field "file", max 100MB, any type except SVG). Returns { url }. ' +
          'To show the file inside an issue/task/project description or a comment, put that url in the ' +
          'rich-text body as ![name](url) for images or [name](url) for any other file — the server ' +
          'renders uploaded urls inline (preview/player/download card). ' +
          'Large files in production should be uploaded client-direct (see GET /api/upload -> { blob }); ' +
          'this multipart route is capped by the serverless request-body limit (~4.5MB).',
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } } } },
        responses: { '200': jsonShape({ type: 'object', required: ['url'], properties: { url: { type: 'string' }, filename: { type: 'string' }, size: { type: 'integer' }, contentType: { type: 'string' } } }, 'Uploaded'), ...errors(400, 401) },
      },
    },
    '/api/users': {
      get: { tags: ['System'], operationId: 'listUsers', summary: 'List users visible to me (workspace-mates)', responses: { '200': jsonList('User'), ...errors(401) } },
    },
    '/api/status': {
      get: { tags: ['System'], operationId: 'getStatus', summary: 'Public health probe', security: [], responses: { '200': jsonShape({ type: 'object', additionalProperties: true }, 'Healthy') } },
    },
    '/api/super-admin/users': {
      get: { tags: ['Super admin'], operationId: 'superAdminListUsers', summary: 'List all users (requires a SUPER_ADMINS email)', responses: { '200': jsonList('User'), ...errors(401, 403) } },
    },
    '/api/super-admin/whitelist': {
      get: { tags: ['Super admin'], operationId: 'superAdminListWhitelist', summary: 'List sign-up whitelist (requires a SUPER_ADMINS email)', responses: { '200': jsonList('WhitelistEntry'), ...errors(401, 403) } },
      post: {
        tags: ['Super admin'], operationId: 'superAdminAddWhitelist', summary: 'Add a whitelist entry (requires a SUPER_ADMINS email)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['type', 'value'], properties: { type: { type: 'string', enum: ['email', 'domain'] }, value: { type: 'string' } } } } } },
        responses: { '201': jsonObject('WhitelistEntry', 'Created'), ...errors(400, 401, 403, 409) },
      },
    },
    '/api/super-admin/whitelist/{id}': {
      parameters: [idParam('id', 'Whitelist entry id.')],
      delete: { tags: ['Super admin'], operationId: 'superAdminRemoveWhitelist', summary: 'Remove a whitelist entry (requires a SUPER_ADMINS email)', responses: { '200': deletedResponse, ...errors(401, 403, 404) } },
    },
    '/api/super-admin/errors': {
      get: {
        tags: ['Super admin'], operationId: 'superAdminListErrors', summary: 'List error events (requires a SUPER_ADMINS email)',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'integer' } },
          { name: 'level', in: 'query', schema: { type: 'string', enum: ['error', 'warn', 'info'] } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'stats', in: 'query', schema: { type: 'boolean' }, description: 'Return aggregate stats instead of rows.' },
          limitParam, cursorParam,
        ],
        responses: { '200': jsonList('ErrorEvent'), ...errors(400, 401, 403) },
      },
      delete: {
        tags: ['Super admin'], operationId: 'superAdminDeleteErrors', summary: 'Bulk-delete error events (requires a SUPER_ADMINS email)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'integer' } } } } } } },
        responses: { '200': jsonShape({ type: 'object', properties: { deleted: { type: 'integer' } }, required: ['deleted'] }, 'Deleted'), ...errors(400, 401, 403) },
      },
    },
    '/api/super-admin/errors/{id}': {
      parameters: [idParam('id', 'Error event id.')],
      get: { tags: ['Super admin'], operationId: 'superAdminGetError', summary: 'Error event detail (requires a SUPER_ADMINS email)', responses: { '200': jsonObject('ErrorEvent'), ...errors(401, 403, 404) } },
      patch: {
        tags: ['Super admin'], operationId: 'superAdminUpdateError', summary: 'Resolve/unresolve an error event (requires a SUPER_ADMINS email)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['resolved'], properties: { resolved: { type: 'boolean' } } } } } },
        responses: { '200': jsonShape({ type: 'object', additionalProperties: true }, 'Updated'), ...errors(400, 401, 403, 404) },
      },
      delete: { tags: ['Super admin'], operationId: 'superAdminDeleteError', summary: 'Delete an error event (requires a SUPER_ADMINS email)', responses: { '200': deletedResponse, ...errors(401, 403, 404) } },
    },
    '/api/auth/register': {
      post: {
        tags: ['Auth'], operationId: 'register', summary: 'Register a new account', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' }, name: { type: 'string' } } } } } },
        responses: { '201': jsonShape({ type: 'object', additionalProperties: true }, 'Registered'), ...errors(400, 409) },
      },
    },
    '/api/auth/password-reset/request': {
      post: {
        tags: ['Auth'], operationId: 'passwordResetRequest', summary: 'Request a password-reset OTP', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string' } } } } } },
        responses: { '200': jsonShape({ type: 'object', additionalProperties: true }, 'OTP sent (if the email exists)'), ...errors(400) },
      },
    },
    '/api/auth/password-reset/confirm': {
      post: {
        tags: ['Auth'], operationId: 'passwordResetConfirm', summary: 'Confirm a password reset with an OTP', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'otp', 'new_password'], properties: { email: { type: 'string' }, otp: { type: 'string' }, new_password: { type: 'string' } } } } } },
        responses: { '200': jsonShape({ type: 'object', additionalProperties: true }, 'Password reset'), ...errors(400) },
      },
    },
    '/api/cli/authorize': {
      post: {
        tags: ['Auth'], operationId: 'cliAuthorize', summary: 'Authorize a CLI login (requires a browser session)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['callback', 'state'], properties: { callback: { type: 'string' }, state: { type: 'string' }, name: { type: 'string', description: 'Token name to mint.' } } } } } },
        responses: { '200': jsonShape({ type: 'object', additionalProperties: true, properties: { redirect_url: { type: 'string' }, token_id: { type: 'integer' }, token_name: { type: 'string' }, plaintext_token: { type: 'string' } } }, 'Authorized — returns the one-time token'), ...errors(400, 401) },
      },
    },
  },
} as const
