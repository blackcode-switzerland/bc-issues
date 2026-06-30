# Backend

How the server side of Blackcode Issues fits together: the API conventions, the
two authentication paths, the workspace-scoped data model, the event spine that
powers activity/inbox/analytics, and how to extend it. **Source of truth is the
code** — `lib/db/schema.ts` for the schema and `app/api/**` for routes; this doc
describes them as they are today.

## Table of contents

- [Stack](#stack)
- [Architecture at a glance](#architecture-at-a-glance)
- [Authentication & authorization](#authentication--authorization)
- [Database schema](#database-schema)
- [The event spine](#the-event-spine)
- [API reference](#api-reference)
- [Query layer](#query-layer)
- [Cross-cutting concerns](#cross-cutting-concerns)
- [Adding new functionality](#adding-new-functionality)
- [Operational notes](#operational-notes)

## Stack

- **Next.js 16** App Router route handlers (`app/api/**/route.ts`).
- **PostgreSQL** via **Drizzle ORM** (`drizzle-orm` + `pg` Pool). Client in
  `lib/db/client.ts`, schema in `lib/db/schema.ts`, migrations in
  `lib/db/migrations/` managed by `drizzle-kit`.
- **NextAuth v4** (JWT sessions) for browser auth; custom `bk_live_…` bearer
  tokens for the API/CLI.
- **bcryptjs** (cost 12) for passwords, **Resend** for transactional email,
  **Vercel Blob** (with a local fallback) for uploads.

## Architecture at a glance

A typical authenticated request:

```
request
  → middleware.ts            (guards /dashboard/* for the browser only)
  → apiHandler(...)          (lib/api/handler.ts — wraps the handler)
      → resolveWorkspace()   (lib/api/workspace-context.ts)
          → resolveAuth()    (lib/auth/resolve.ts — bearer token OR session)
          → getWorkspaceForUser()  → { user, workspace, role }
      → query layer          (lib/db/queries/* — the only place that touches the DB)
          → recordEvent(tx)  (events spine, in the same transaction)
              → fanOutEvent(tx)  (materializes inbox rows)
  → NextResponse.json(...)
```

Key principles:

- **Routes are thin.** They authenticate, validate input, call a query-layer
  function, and shape the JSON. Business logic lives in `lib/db/queries/`.
- **Every domain mutation records an event** in the same transaction (see
  [event spine](#the-event-spine)). There are deliberately **no DB triggers**.
- **Everything is workspace-scoped.** Access is decided by workspace
  membership; there is no global admin role.

### `apiHandler` and error model

`apiHandler(fn)` (`lib/api/handler.ts`) wraps a route handler and converts any
thrown error into a canonical JSON body:

```jsonc
{ "error": "human message", "code": "machine_code", "suggestion"?: "...", "details"?: {...} }
```

- Throw an `ApiError` (via the `Errors` factory) for expected client errors.
- `4xx` ApiErrors are returned as-is and **not** logged.
- `5xx` and any non-`ApiError` throwable are logged to the `error_events` table
  (with route, method, status, sanitized context — see
  [`sanitize.ts`](#error-responses--sanitization)) and surfaced as a generic
  500.

The `Errors` factory (`lib/api/errors.ts`):

| Call | Status | Code |
|------|--------|------|
| `Errors.unauthorized(msg?)` | 401 | `unauthorized` |
| `Errors.forbidden(msg?)` | 403 | `forbidden` |
| `Errors.notFound(entity)` | 404 | `${entity}_not_found` |
| `Errors.badRequest(code, msg, details?)` | 400 | _custom_ |
| `Errors.conflict(code, msg, details?)` | 409 | _custom_ |
| `Errors.unprocessable(code, msg, details?)` | 422 | _custom_ |
| `Errors.tooManyRequests(msg?)` | 429 | `too_many_requests` |
| `Errors.internal(msg?, details?)` | 500 | `internal_error` |

## Authentication & authorization

### Two ways to authenticate

`resolveAuth(req)` (`lib/auth/resolve.ts`) returns `{ user, via }` or `null`,
checking in order:

1. **Bearer token** — `Authorization: Bearer bk_live_…`. Verified by
   `verifyToken()` (`lib/auth/tokens.ts`).
2. **Session cookie** — a NextAuth JWT, validated by `getValidatedSessionUser()`
   (`lib/auth/session.ts`).

`resolveUser(req)` is the convenience wrapper that returns just the `User`.

### NextAuth (`lib/auth.ts`)

- **Strategy:** JWT (no server session table).
- **Providers:**
  - **Credentials** — email + password. Verifies with `verifyPassword()`
    (bcrypt) and stamps `last_login`.
  - **Google** — registered **only if** `GOOGLE_CLIENT_ID` and
    `GOOGLE_CLIENT_SECRET` are set.
- **On first sign-in** the `signIn`/`jwt` callbacks upsert the user, ensure a
  default workspace, and materialize any pending email invitations.
- The JWT carries `id`, `pwStamp` (a snapshot of `password_changed_at`), and `isSuperAdmin` (derived from the `SUPER_ADMINS` env var at sign-in time).

**Session invalidation on password change:** `getValidatedSessionUser()`
re-checks that the user still exists, is not soft-deleted, and that the token's
`pwStamp` still matches `users.password_changed_at`. Resetting a password bumps
that column, so **every existing browser session is invalidated**. API tokens
are a separate credential and are unaffected.

### API tokens (`lib/auth/tokens.ts`)

- Plaintext format: `bk_live_` + 32 random bytes (base64url). **Shown once.**
- Stored as `token_hash` (SHA-256) plus a `token_prefix` for display; verified
  with a timing-safe comparison; `last_used_at` is updated on use; optional
  `expires_at` is honored.
- Sent as `Authorization: Bearer <token>`.

**CLI authorize flow** (`POST /api/cli/authorize`,
`app/api/cli/authorize/route.ts`): the browser, already signed in, posts a
loopback `callback` + `state`; the server mints a token and returns a
`redirect_url` pointing back at the CLI's local listener with the token. Only
`http://localhost` / `127.0.0.1` / `[::1]` callbacks are accepted.

### Passwords & reset

- `lib/auth/password.ts` — `hashPassword`/`verifyPassword` (bcryptjs, 12
  rounds), plus length validation (8–200 chars).
- `lib/db/queries/password-reset.ts` — OTP flow. A short code is emailed (via
  Resend), stored only as a hash in `password_reset_otps`, capped at 5 attempts,
  rate-limited per email, and expires fast. Drives both the logged-out
  "forgot password" flow and the in-app Settings → Account flow.

### Workspace authorization

`resolveWorkspace(req, wsSlugOrId)` (`lib/api/workspace-context.ts`) returns:

```ts
{ user: User, workspace: Workspace, role: 'owner' | 'member' }
```

It authenticates the user, then loads the workspace **and the caller's
membership** in one step. If the workspace doesn't exist *or* the user isn't a
member it throws `notFound` (404, not 403 — so we don't leak existence).
`requireOwner(ctx)` throws `forbidden` unless `ctx.role === 'owner'`.

> **Super admin** is env-based, not DB-based. Set `SUPER_ADMINS=email1,email2` in
> the environment. Super admins bypass the access whitelist and get a "Super Admin"
> section in the sidebar with platform-wide views. Guard API routes with
> `requireSuperAdminUser(req)` from `lib/api/super-admin-guard.ts`.
>
> All workspace-level authority is workspace membership +
> `workspace_members.role` (`owner` | `member`). The old `users.role` column
> was dropped in migration `0012`.

## Database schema

Defined in `lib/db/schema.ts` (Drizzle). Grouped by concern below; see the file
for exact column types, indexes, and check constraints.

### Identity & access

| Table | Purpose / notable columns |
|-------|---------------------------|
| `users` | `email` (unique), `password_hash`, `google_id`, `avatar_url`, `tagline`, `active_workspace_id` (soft FK), `password_changed_at`, `deleted_at` (soft delete — email can be reused) |
| `workspaces` | `name`, `slug` (unique), `owner_id`, `logo_url`, `deleted_at` |
| `workspace_members` | `(workspace_id, user_id)` unique; `role` ∈ `owner` \| `member` |
| `workspace_counters` | per-workspace sequence allocators: `last_issue_seq`, `last_project_seq`, `last_task_seq` (allocated in-transaction by `allocateNext*Seq`) |
| `workspace_invitations` | `email`, `token` (unique), `role`, `status` ∈ `pending`/`accepted`/`revoked`/`expired`/`declined`, `expires_at` |
| `api_tokens` | `token_hash` (unique), `token_prefix`, `scopes` (default `['full']`), `expires_at`, `last_used_at` |
| `password_reset_otps` | `email`, `otp_hash`, `expires_at`, `consumed_at`, `attempts` |
| `email_whitelist` | Platform access control (migration `0023`). `type` ∈ `email` \| `domain`; `value` is the address or domain; `added_by` FK to users. Active only when `SUPER_ADMINS` env var is set. |

### Work items

| Table | Purpose / notable columns |
|-------|---------------------------|
| `projects` | `workspace_id`, `seq` (workspace-scoped #number, unique per workspace), `name`, `status`, `priority` (`P0`–`P4`), `owner_id` (lead), `color`, `icon`, `start_date`, `due_date` |
| `project_updates` | status-update feed; `status` ∈ `on_track`/`at_risk`/`off_track`, rich-text `body`, `author_id`. Latest row = project's current health |
| `tasks` | `workspace_id`, `seq` (workspace-scoped #number, unique per workspace — mirrors `issues.seq`), optional `project_id` (ON DELETE SET NULL — tasks can be standalone), `due_date`, `status`, `lead_id` (task lead, ON DELETE SET NULL — mirrors `projects.owner_id`) |
| `issues` | `workspace_id`, `seq` (unique per workspace), optional `project_id`/`task_id`, `title`, `status`, `priority` (int 1–5, checked), `reporter_id`, `start_date`/`due_date`, `estimated_hours`, `completed_at`/`cancelled_at`. **No `assignee_id` — see `issue_assignees`** |
| `issue_assignees` | many-to-many junction: `(issue_id, user_id)` composite PK; `assigned_at`. Replaces the old single `assignee_id` column so issues can have multiple assignees. Both FKs cascade on delete |
| `comments` | **polymorphic**: `parent_type` ∈ `issue`/`task`/`project` + `parent_id`; `content`, `mentions` (int[]), `edited_at`. Legacy `issue_id` retained for one release |
| `attachments` | `issue_id`, `filename`, `file_url`, `file_size`, `mime_type`, `uploaded_by`. Issues-only; written via API/CLI (`bk issue attach`) |
| `uploads` | **upload ledger** — one row per file stored through our pipeline, written at upload time: `workspace_id` (nullable), unique `url`, `pathname`, `filename`, `size` (bigint), `mime_type`, `uploaded_by`. Metadata only — never the authority for deletion (a live reference scan is); source for the Storage page |
| `labels` | **workspace-level** (`workspace_id`), `name`, `color`, `created_by` |
| `issue_labels` / `project_labels` | join tables (composite PKs) linking workspace labels to issues / projects |
| `project_members` | the project's "people working on it" list (not access control); `(project_id, user_id)` unique |
| `issue_watchers` | `(issue_id, user_id)` PK; `reason` ∈ `manual`/`assigned`/`reporter`. Auto-watchers are pruned when their reason no longer applies (unless `manual`) |

### System

| Table | Purpose |
|-------|---------|
| `events` | **append-only spine** (`bigserial`). `entity_type`, `entity_id`, `action`, `diff`, `meta`, `actor_user_id`/`actor_token_id`, `idempotency_key`. Indexed by workspace × (occurred_at / entity / actor / action) |
| `inbox_messages` | per-user projection of events (`bigserial`). `type`, denormalized `payload` (JSON), `read_at`, `archived_at`. `event_id`/`workspace_id` nullable for synthetic rows |
| `transaction_log` | legacy undo log: `operation_type`, `table_name`, `record_id`, `old_data`/`new_data`, `rolled_back` |
| `error_events` | platform error log: `level`, `code`, `message`, `stack`, `route`, `method`, `status_code`, sanitized `context`, plus triage state `resolved` / `resolved_at` / `resolved_by`. Written by `apiHandler` (server 5xx), `/api/errors/client` (client boundary) and `lib/email` (job failures); triaged from the super-admin Errors tab |

Status/priority **values** (the labels and colors the UI uses) are canonical in
`lib/work-items.ts`, not the schema:

- Issue status: `backlog`, `todo`, `in_progress`, `done`, `cancelled`.
- Issue priority: `1` urgent … `4` low, `5` none.
- Project status: `backlog`, `planned`, `in_progress`, `completed`, `cancelled`;
  priority `P0`–`P4`.
- Project update health: `on_track`, `at_risk`, `off_track`.

## The event spine

`lib/db/queries/events.ts` defines `recordEvent(tx, input)` — called **inside
the same transaction** as every domain mutation. `EntityType` and `EventAction`
are TypeScript unions (e.g. `assigned`, `status_changed`, `commented`,
`mentioned`, `member_added`, `invitation_created`, …).

Each recorded event is handed to `fanOutEvent(tx, event)`
(`lib/db/queries/fanout.ts`), which materializes per-user `inbox_messages`
according to the event type (assignees, watchers, mentioned users, invitees).
`lib/db/queries/inbox.ts` writes those rows with a short dedup window so rapid
status flips don't spam the inbox.

**Coalescing.** Generic `updated` events (title/description/etc. edits on
issues/tasks/projects) pass `coalesceWindowMs: UPDATE_COALESCE_WINDOW_MS` (10
min) to `recordEvent`. When the same actor records another `updated` on the same
entity inside that window, the existing row is merged in place — earliest
`before`, latest `after`, advanced `occurred_at` — instead of inserting a new
row. This keeps autosave (which PATCHes every ~1.2s while typing) from flooding
the activity feed. Only safe for actions that **don't** fan out to the inbox
(`updated` hits the `default` case in `fanOutEvent`); never enable it for
discrete events like `status_changed` or `assigned`.

This single spine is read by:

- **Activity feed** (`activity.ts`, `/api/workspaces/{ws}/activity`),
- **Inbox** (`inbox.ts`, `/api/me/inbox`),
- **Analytics** (`analytics.ts`).

### Analytics contract (`analytics.ts`)

`computeAnalytics(input)` returns one `AnalyticsPayload` for the requested
**view** (`workspace` | `project` | `task` | `member`) + optional target
`id` + date window + faceted filters. Everything is workspace-scoped (no
cross-workspace leakage) and computed live (no materialized views) — fine up to
~100k events/workspace.

Query params on `GET /api/workspaces/{ws}/analytics`:

- `view`, `id` — scope. `id` required for non-workspace views.
- `from`, `to` — ISO timestamps. Omitted ⇒ all-time snapshot, with series/
  throughput defaulting to the last 30 days.
- `interval` — `day` (default) | `week`; controls time-series bucket width.
- `status`, `priority`, `label`, `assignee` — **faceted filters**, repeatable
  and/or CSV (`?status=todo&status=done` or `?status=todo,done`). Appended as
  `AND` clauses to every issue query so all charts stay mutually consistent.
  `priority` is 1–5; `label`/`assignee` are ids.

Payload sections: `summary` (snapshot counts + overdue/unassigned/completion
rate/avg+median cycle time/open estimate), `trends` (created/completed/cycle
time/active members vs. the previous equal-length window — `null` for all-time),
distributions (`by_status`, `by_priority`, `by_assignee` incl. per-assignee avg
cycle, `by_label`, `by_project` for workspace/member views), time series
(`velocity_series`, `activity_series`), histograms (`cycle_time_buckets`,
`aging_buckets`), `activity_by_action`, `top_active_members`, and — task
view only — `burndown_series` (`remaining` vs. a straight-line `ideal`).

## API reference

> **Recommended interface for agents:** prefer the `bk` CLI over calling these
> HTTP routes directly. The CLI wraps the same endpoints but handles auth,
> JSON-body encoding, pagination, file upload+embed, and stable exit codes — so
> automated/agent runs are more reliable. The HTTP API stays fully supported;
> reach for it directly only when the CLI can't cover a case. See
> [`docs/cli.md`](./cli.md). This is a recommendation, not a requirement.

### Conventions

- All handlers are wrapped in `apiHandler`. Mutations validate input and throw
  `Errors.badRequest(...)` on bad shapes.
- Workspace-scoped routes resolve `{ ws }` (slug **or** numeric id) via
  `resolveWorkspace`.
- **All list endpoints return `{ data, next_cursor }`** — `next_cursor` is a
  numeric cursor to pass back as `?cursor=`, or `null` when there are no further
  pages (including inherently unpaginated lists). Some lists also include
  `total`. Build the body with `jsonList()` (`lib/api/responses.ts`) so the
  envelope can't drift. Single resources return the bare entity object.
- **Mutations:** create → `201` + the created entity; update → `200` + the
  updated entity; delete → `200` + `{ deleted: true }` (plus `mode` where the
  resource cascades, e.g. projects/tasks).
- **Rich-text fields** (issue/project descriptions, comments, project-update
  bodies) accept **Markdown or HTML** and are normalized to **sanitized HTML** on
  write via `lib/rich-text.ts` (`toRichTextHtml`), applied in the query layer so
  every surface benefits. Markdown is converted (and a common agent mistake —
  literal `\n` instead of real newlines — is tolerated); existing HTML (web
  editor) is passed through and sanitized again at render by the display layer.
- **Embedding uploaded files in rich text.** `toRichTextHtml` also runs
  `upgradeUploadedMedia`: a reference to a file uploaded through our own pipeline
  (Vercel Blob, or `/uploads` in dev) — written as a Markdown image `![](url)` or
  a link `[name](url)` — is rewritten into the TipTap node the editor uses (an
  `<img>`, or a `<div data-type="file-attachment" data-file-url data-filename
  data-content-type>` for video/audio/other). Media type is inferred from the
  url's extension. This is what lets the CLI/API embed files inline with plain
  Markdown — they never construct app-specific markup. **Only our upload-origin
  urls are upgraded**; external links/images are left untouched. The render-layer
  DOMPurify whitelists the same `data-*` attributes, and the server sanitizer
  allowlist permits the `div` node, so the embed survives end-to-end. Covered by
  `lib/rich-text.test.ts`. The node's wire format (tag, `data-type` marker, and
  `data-*` attribute names) lives in **one** place — `lib/file-attachment.ts` —
  imported by both the server emitter/sanitizer (`lib/rich-text.ts`) and the
  editor's parse/render + DOMPurify allowlist (`components/rich-text-editor.tsx`),
  so the two sides can't drift.

### Discovery (for agents & tooling)

Three unauthenticated-friendly entry points make the API self-describing:

```
GET /api/openapi.json   OpenAPI 3.1 document (public). Source: lib/openapi/spec.ts.
GET /api/docs           Human-readable API reference (Scalar, renders the spec above).
GET /api/meta           Authenticated bootstrap: { user, active_workspace, vocabulary,
                        labels, projects, members }. ?ws=<slug|id> targets a workspace.
```

`GET /api/meta` is the call an agent should make first: it returns the active
workspace plus the canonical issue/project **vocabulary** (statuses, priorities,
project-update health — value/label/color, from `lib/work-items.ts`) so the agent
never guesses an enum value. The OpenAPI spec is hand-authored and covers the
**entire feature surface** — every route under `app/api/**` except true internals
(the NextAuth handler, the `/api/errors/client` beacon, and the `/api/docs` +
`/api/openapi.json` discovery routes themselves). It imports the enums from
`lib/work-items.ts` so valid status/priority values can't drift.

**Parity is enforced by a test** (`lib/openapi/parity.test.ts`, run by `npm
test`): it walks `app/api/**` and fails if any route+method is missing from
`lib/openapi/spec.ts` or if the spec describes a route that doesn't exist. So
when you add, remove, or change a route, update `lib/openapi/spec.ts` in the same
change or the build breaks.

### Workspace-scoped (canonical)

> **`{id}` for projects/tasks/issues = the workspace `seq` (the `#N` shown in the
> app), not the global PK.** Route handlers resolve `(workspace, seq) → internal
> id` via `resolveEntityId` (`lib/api`); responses serialize through
> `publicProject`/`publicTask`/`publicIssue` (`lib/api/serialize.ts`) so the
> global id is never emitted and FK fields (`project_id`/`task_id`) are the
> parent's seq. List endpoints return everything (no cursor). See
> `docs/api-changelog.md`. Sub-entities (comments/labels/attachments/updates)
> keep their own ids — but any FK that points **back** at a work item is also
> mapped to that item's `#number`, never the internal id: comments expose
> `parent_id` (+ `parent_type`) and drop the legacy internal `issue_id`;
> attachments expose `issue_id` as the `#number`; project updates expose
> `project_id` as the `#number`. These go through `publicComment` /
> `publicAttachment` / `publicProjectUpdate` (`lib/api/serialize.ts`), which take
> the parent's seq from the request path (or resolve it for by-id routes). The
> activity feed (`GET …/activity`) likewise maps `entity_id` to the `#number` for
> issue/task/project events (`publicEvent` + `resolveEventEntitySeqs`, batch seq
> lookup incl. trashed rows; purged → `meta.seq` fallback or `null`); other
> entity types (comment/label/attachment/workspace/member/invitation) keep their
> own-domain id. No route emits an internal work-item serial.

```
GET    /api/workspaces                          list my workspaces
POST   /api/workspaces                          create workspace
GET    /api/workspaces/{ws}                     workspace detail
PATCH  /api/workspaces/{ws}                     update (owner)
DELETE /api/workspaces/{ws}                     delete (owner)
POST   /api/workspaces/{ws}/transfer            transfer ownership (owner)
POST   /api/workspaces/{ws}/leave               leave workspace

GET    /api/workspaces/{ws}/members             list members
DELETE /api/workspaces/{ws}/members/{userId}    remove member (owner)

GET    /api/workspaces/{ws}/invitations         list (owner)
POST   /api/workspaces/{ws}/invitations         invite by email (owner)
DELETE /api/workspaces/{ws}/invitations/{id}    revoke (owner)
GET    /api/workspaces/{ws}/invite-candidates    suggested people to invite (owner)

GET    /api/workspaces/{ws}/projects            list projects
POST   /api/workspaces/{ws}/projects            create project
GET    /api/workspaces/{ws}/projects/{id}       project detail (+ members, labels)
PATCH  /api/workspaces/{ws}/projects/{id}       update (also member_ids/label_ids)
GET    /api/workspaces/{ws}/projects/{id}/members  list members / POST add (owner|admin) / DELETE remove ({user_id})
GET    /api/workspaces/{ws}/projects/{id}?preview=1   child counts for delete dialog
DELETE /api/workspaces/{ws}/projects/{id}?mode=cascade|detach   move to Trash (default: detach)
GET    /api/workspaces/{ws}/projects/{id}/comments   list / POST comment
GET    /api/workspaces/{ws}/projects/{id}/updates    list status updates
POST   /api/workspaces/{ws}/projects/{id}/updates    post update (status + body)
DELETE /api/workspaces/{ws}/projects/{id}/updates/{updateId}   delete (author)
POST   /api/workspaces/{ws}/projects/reorder    update display order (drag-and-drop)

GET    /api/workspaces/{ws}/tasks          list / POST create
GET    /api/workspaces/{ws}/tasks/{id}?preview=1   child counts for delete dialog
PATCH  /api/workspaces/{ws}/tasks/{id}     update
DELETE /api/workspaces/{ws}/tasks/{id}?mode=cascade|detach   move to Trash (default: detach)
GET    /api/workspaces/{ws}/tasks/{id}/comments  list / POST

GET    /api/workspaces/{ws}/issues              list (filters) / POST create
                                               (filters: project_id, task_id (workspace #numbers),
                                                assignee_id(s) (user ids), status, priority, search.
                                                search = case-insensitive substring on title/description,
                                                and the #id when the query is numeric (e.g. "123"/"#123");
                                                same for tasks (name/description) and projects (name/description)
                                                via lib/db/queries/search.ts.
                                                Returns { data, total } — every match, no pagination.
                                                create accepts project_id/task_id as #numbers; label_ids
                                                (existing) and labels: string[] — names matched
                                                case-insensitively, unknown ones created on the fly)
GET    /api/workspaces/{ws}/issues/{id}         detail / PATCH
DELETE /api/workspaces/{ws}/issues/{id}         move to Trash
GET    /api/workspaces/{ws}/issues/{id}/comments     list / POST
GET    /api/workspaces/{ws}/issues/{id}/labels       list / POST attach ({label_id} or {name} — name created on the fly)
DELETE /api/workspaces/{ws}/issues/{id}/labels/{lid} detach
GET    /api/workspaces/{ws}/issues/{id}/activity      activity feed for the issue
GET    /api/workspaces/{ws}/issues/{id}/attachments   list / POST attach
DELETE /api/workspaces/{ws}/issues/{id}/attachments/{attachmentId}  remove attachment
POST   /api/workspaces/{ws}/issues/{id}/watch        watch / DELETE unwatch
POST   /api/workspaces/{ws}/issues/reorder      update display order (drag-and-drop)

GET    /api/workspaces/{ws}/labels              list / POST create
GET    /api/workspaces/{ws}/labels/{id}         label detail
PATCH  /api/workspaces/{ws}/labels/{id}         update / DELETE
DELETE /api/workspaces/{ws}/comments/{id}       edit/delete a comment (author)

GET    /api/workspaces/{ws}/activity            activity feed
GET    /api/workspaces/{ws}/analytics           analytics (view/target/range/interval/filters)

GET    /api/workspaces/{ws}/trash               list binned items (?type=issue|project|task)
POST   /api/workspaces/{ws}/trash/restore       restore items ({items:[{type,id}]|batch_id, dry_run?, resolutions?})
DELETE /api/workspaces/{ws}/trash/purge         permanent delete — owner only ({items|batch_id}); auto-frees unreferenced files
POST   /api/workspaces/{ws}/trash/empty         hard-delete everything in the bin — owner only; auto-frees unreferenced files

GET    /api/workspaces/{ws}/storage             list uploaded files w/ references + usage — owner only
DELETE /api/workspaces/{ws}/storage/{id}        delete an orphaned file — owner only (409 if referenced)
GET    /api/workspaces/{ws}/attachments         workspace-wide attachments table view — owner only
```

**Storage / file cleanup.** Uploaded files are recorded in the `uploads` ledger
(written at upload time on every path — multipart `/api/upload`, the client-direct
`/api/upload/blob` handshake's `onUploadCompleted`, all attributed to an explicit
workspace or the user's active one). Blob removal happens in exactly two places,
both gated by `isUrlReferencedAnywhere` (`lib/blob-refs.ts`) — a live, system-wide
scan of all content bodies + attachment rows, **including trashed items**:

1. **Owner-confirmed delete** — the `storage` routes / Storage page, for any
   0-reference file (including orphans left by editing).
2. **Automatic GC** (`sweepOrphanedUrls`, `lib/blob-gc.ts`) — fires on terminal
   deletes: `deleteComment` (comment/reply) and `purgeItems` (trash purge/batch/
   empty, via `purgeBatch`/`emptyTrash`). It gathers the URLs the removed content
   embedded (bodies, issue attachments, project updates, cascaded comments),
   then, after the rows are gone, deletes each file nothing else references.

Both call `removeBlobBytes` (`@vercel/blob` `del()`, or `fs.rm` for local
`/uploads`). *Editing* a file out of a still-living body never deletes bytes
(undo/restore stay safe); all blob deletion is best-effort and never fails the
user's action.

### Super admin (requires `SUPER_ADMINS` env var)

```
GET  /api/super-admin/users            all platform users (name, email, workspace count, last login)
GET  /api/super-admin/whitelist        list whitelist entries
POST /api/super-admin/whitelist        add entry ({ type: 'email'|'domain', value })
DELETE /api/super-admin/whitelist/{id} remove entry
GET  /api/super-admin/errors           error log (cursor-paginated). Filters: ?status=open|resolved, ?level=, ?from=&to= (ISO), ?cursor=&limit=, ?stats=1 (adds aggregate counts)
DELETE /api/super-admin/errors         bulk delete ({ ids: number[] }, max 500); returns { deleted: <count> }
GET  /api/super-admin/errors/{id}      full event detail incl. stack + context
PATCH /api/super-admin/errors/{id}     toggle triage state ({ resolved: boolean })
DELETE /api/super-admin/errors/{id}    permanently delete one event
```

All super-admin routes are guarded by `requireSuperAdminUser(req)` — 401 if
unauthenticated, 403 if the caller's email is not in `SUPER_ADMINS`. The guard
calls `resolveUser`, so it accepts **both** session cookies and `bk_live_…`
bearer tokens — these endpoints are fully usable from the `bk` CLI
(`bk super-admin …`), and a non-super-admin token gets the same 403. There is no
separate "super-admin token" scope: privilege is derived from the token owner's
email at request time.

### Personal, auth & system

```
GET/POST /api/auth/[...nextauth]                NextAuth
POST     /api/auth/register                     email/password sign-up (403 if not whitelisted)
POST     /api/auth/password-reset/request       request OTP
POST     /api/auth/password-reset/confirm       confirm OTP + set password

GET      /api/me                                current user (+ active_workspace_id, via, is_super_admin)
POST     /api/me/active-workspace                set active workspace
GET      /api/me/inbox                            list inbox  (?unread, ?limit)
POST     /api/me/inbox/mark-read                  mark read (ids | all)
POST     /api/me/inbox/archive                    archive ids
POST     /api/me/inbox/unarchive                  unarchive ids
GET      /api/me/pending-invitations             invitations for my email
POST     /api/me/password/request-otp            in-app password change (OTP)
POST     /api/me/password/confirm

POST     /api/invitations/accept                 accept by token
POST     /api/invitations/decline                decline by token

GET/POST /api/tokens                             list / mint API tokens
DELETE   /api/tokens/{id}                         revoke
POST     /api/cli/authorize                       mint a token for the CLI

POST     /api/upload                              multipart file upload (local dev / small files)
POST     /api/upload/blob                          Vercel Blob client-upload token handshake (prod; large files)
GET/POST /api/undo                                transaction history / rollback
GET      /api/status                              public health probe
GET      /api/status/errors , /errors/{id}        error log (owner-gated detail)
POST     /api/errors/client                       client error beacon
```

### Legacy non-workspace shims

The implicit-active-workspace duplicates of the core entities —
`/api/projects`, `/api/issues`, `/api/tasks` and all their `/{id}`
children (incl. `/api/issues/{id}/comments`, `/attachments`, `/activity` and
`/api/projects/{id}/members`) — have been **removed**. Both the web app and the
`bk` CLI now call the canonical `/api/workspaces/{ws}/...` routes exclusively.
The scoped routes for issue attachments, issue activity, and project members
were added as part of that consolidation.

The non-entity legacy duplicates `/api/activity` and `/api/analytics` have also
been **removed** — both the web app and the `bk` CLI now use
`/api/workspaces/{ws}/activity` and `/api/workspaces/{ws}/analytics`. The former
`/api/users/me` auth-probe was folded into `GET /api/me`, which now also returns
`via` (`session` | `token`). `/api/users` (the visible-users list behind
`bk user list`) is **not** a duplicate of any scoped route and remains.

`bk analytics` keeps full web-dashboard parity through the scoped route: pass the
workspace in the path (`/api/workspaces/{ws}/analytics`) and the same `view`,
`id`, `from`, `to`, `interval`, and `status`/`priority`/`label`/`assignee`
filters (all via `parseAnalyticsParams`).

## Query layer

Everything that touches the database lives in `lib/db/queries/`. Routes call
these; they never write SQL inline.

| File | Responsibility |
|------|----------------|
| `workspaces.ts` | workspace CRUD, membership, `getWorkspaceForUser`, issue-seq allocation |
| `members.ts` | project member listing |
| `invitations.ts` | invite CRUD, token mint, accept/decline, pre-signup materialization |
| `invite-candidates.ts` | suggested invitees — members of the owner's other workspaces (with shared-workspace context), plus all platform users for super admins; flags `already_member` / `invited` |
| `users.ts` | user CRUD, `getVisibleUsers` (workspace-mates only — privacy guard), OAuth upsert, password sign-up |
| `projects.ts` | project CRUD; list joins lead + latest update health |
| `project-relations.ts` | project ↔ member and project ↔ label sets |
| `project-updates.ts` | status-update feed (on_track/at_risk/off_track) |
| `tasks.ts` | task CRUD (project optional); list/get join the task lead; PATCH `lead_user_id` writes `lead_id` and records an `assigned`/`unassigned` event |
| `issues.ts` | issue CRUD, seq allocation, field-level events, auto-watchers |
| `comments.ts` | polymorphic comments + `@email` mention resolution |
| `labels.ts` | workspace labels; case-insensitive unique names |
| `attachments.ts` | issue attachments; `getWorkspaceAttachments` (owner-wide view) |
| `uploads.ts` | upload ledger: `recordUpload` (idempotent on url), `listWorkspaceUploads`, `getUpload`, `deleteUploadRow`, `computeWorkspaceStorageUsage` |
| `watchers.ts` | issue watchers (manual/assigned/reporter) |
| `events.ts` | the event spine — `recordEvent`, `EntityType`/`EventAction` |
| `fanout.ts` | event → per-user inbox materialization |
| `inbox.ts` | inbox writes (dedup window) + listing |
| `activity.ts` | activity feed reads |
| `analytics.ts` | workspace/project/task/member analytics — see below |
| `deletion.ts` | soft-delete engine — `softDelete*`, `previewDeletion`, `listTrash`, `previewRestore`, `restoreItems/Batch`, `purgeItems/Batch`, `emptyTrash` |
| `transaction.ts` | transaction log + `undoLastOperations` |
| `error-events.ts` | error log reads (public list redacts; detail is gated) |
| `password-reset.ts` | OTP issue/verify/consume |
| `whitelist.ts` | `isEmailAllowedByDb`, `listWhitelist`, `addWhitelistEntry`, `removeWhitelistEntry` |
| `admin.ts` | `listAllPlatformUsers` — cross-workspace user listing for super admin view |

## Cross-cutting concerns

### CLI version signaling

`apiHandler` stamps two headers on **every** API response, sourced from
`lib/cli-version.ts` (override via `BK_CLI_LATEST` / `BK_CLI_MIN` env, no redeploy):

- `X-BK-CLI-Latest` — newest published `bk` CLI. The CLI shows a throttled
  "update available" notice when the caller is behind it.
- `X-BK-CLI-Min` — minimum CLI the API supports. The CLI hard-refuses (exit code
  8) below this. **Raise `CLI_MIN_VERSION` whenever a server change breaks older
  CLIs** (e.g. the milestone→task / key-removal rename) so stale clients get a
  clear "please upgrade" instead of cryptic 404s.

### Middleware (`middleware.ts`)

NextAuth `withAuth` guarding `matcher: ['/dashboard/:path*']` — unauthenticated
browser visits to the dashboard redirect to `/login`. **API routes are not
guarded here**; each route authenticates itself via `resolveAuth`/
`resolveWorkspace` (so bearer-token clients work).

### Event spine, inbox & activity

See [The event spine](#the-event-spine). Anything user-visible that "happened"
should `recordEvent` so it shows up in activity and (where appropriate) the
inbox — don't write to `inbox_messages` directly from a route.

### Transaction log / undo

`transaction.ts` + `/api/undo`. `GET` returns recent entries; `POST {count}`
(clamped 1–10) reverses the caller's last operations (issue updates restore
`old_data`, inserts are deleted) and marks them `rolled_back`. This log is
separate from the event spine.

### File uploads (`app/api/upload/route.ts`, `app/api/upload/blob/route.ts`)

Two paths, chosen by the client (`lib/upload.ts` → `uploadFile`, the single
helper used by every editor/avatar uploader). The size cap (`MAX_UPLOAD_BYTES`,
**100 MB**) lives in `lib/upload.ts` and is imported by both routes.

- **Production (Blob configured)** — `uploadFile` uploads **client-direct** to
  Vercel Blob; only the token handshake hits `POST /api/upload/blob`
  (`@vercel/blob/client` `handleUpload`). This bypasses the serverless ~4.5 MB
  request-body limit, so files up to 100 MB work in prod. The handshake auths the
  user, blocks SVG, and sets `maximumSizeInBytes` (Blob enforces it).
- **Local dev (no `BLOB_READ_WRITE_TOKEN`)** — `uploadFile` POSTs multipart to
  `POST /api/upload`, which writes to `public/uploads/`.

The client picks the path from `GET /api/upload` (`{ blob: boolean }`, memoized).
Both reject `image/svg+xml` (XSS). `POST /api/upload` returns
`{ url, filename, size, contentType }`. No new env var is needed —
`BLOB_READ_WRITE_TOKEN` (already required for Blob) activates the prod path.

### Email (`lib/email/`)

Resend client, lazily constructed and **only enabled when both `RESEND_API_KEY`
and `RESEND_FROM_EMAIL` are set** (`emailEnabled()`). Sending is best-effort —
failures log a warning and never break the triggering action. Two templates are
sent: **workspace invitations** and **password-reset OTP**; everything else
stays in the in-app inbox.

### Error responses & sanitization

`lib/api/sanitize.ts` recursively redacts sensitive keys (`password`, `token`,
`authorization`, `cookie`, `secret`, `api_key`, …), caps depth/length/array
size, and is applied before any error context is written to `error_events`.
Combined with `apiHandler`, this means 5xx errors are captured for the
`/status` page without leaking credentials.

## Adding new functionality

### A new API endpoint

1. Create `app/api/.../route.ts`, export `GET`/`POST`/… wrapped in `apiHandler`.
2. Call `resolveWorkspace(req, ws)` (or `resolveUser`) to authenticate.
3. Validate the body; throw `Errors.badRequest(...)` on bad input.
4. Delegate to a function in `lib/db/queries/` — don't inline SQL.
5. In that query function, `recordEvent(tx, …)` inside the mutation's
   transaction if it's user-visible.

### A new column

Edit `lib/db/schema.ts` → `npm run db:generate` → review the SQL in
`lib/db/migrations/` → `npm run db:migrate`.

### A new table

Add the `pgTable` to `schema.ts` (with `workspace_id` if it's tenant data),
export its `$inferSelect`/`$inferInsert` types, generate + apply the migration,
then add a `lib/db/queries/<thing>.ts` module. `project_updates` (migration
`0018`) is a recent, minimal end-to-end example.

## Operational notes

### Local development

```bash
docker compose up -d        # Postgres 16 on localhost:5434
npm install
npm run db:migrate
npm run dev                 # http://localhost:3000
```

### Database client (`lib/db/client.ts`)

A `pg` `Pool` (max 10) built from `DATABASE_URL`, wrapped by Drizzle and cached
on `globalThis` so hot reload doesn't leak connections. The
`@neondatabase/serverless` driver is a dependency for serverless Postgres
compatibility, but the default client uses `pg`.

### Migrations

Managed by `drizzle-kit` (config in `drizzle.config.ts`):

```bash
npm run db:generate   # author a migration from schema diffs
npm run db:migrate    # apply pending migrations
npm run db:push       # push schema directly (prototyping only)
npm run db:studio     # browse data
```

Migration files are numbered `0000_…` upward in `lib/db/migrations/`, with
snapshots under `meta/`. Don't hand-edit applied migrations; add a new one.

### Access whitelist (opt-in)

When `SUPER_ADMINS` is set, the whitelist feature activates:

- **Registration** (`POST /api/auth/register`) returns `403 not_in_whitelist` if
  the email doesn't match an `email_whitelist` row or the `SUPER_ADMINS` list.
- **Google OAuth sign-in** redirects to `/blocked` instead of creating an account.
- **Invitations** (`POST /api/workspaces/{ws}/invitations`): if the invitee is not
  whitelisted, non-super-admins get a 403; super admins auto-add the email and proceed.

When `SUPER_ADMINS` is not set (or empty), all emails are allowed and the
whitelist table is ignored entirely.

Helper utilities: `lib/auth/whitelist.ts` (`isSuperAdmin`, `isEmailAllowed`,
`isWhitelistEnabled`) and `lib/api/super-admin-guard.ts` (`requireSuperAdminUser`).

### Bootstrapping

Set `SUPER_ADMINS=your@email.com` in the environment before the first user signs
up. Super admins can then add domains (`blackcode.ch`) or individual emails to
the whitelist via `/dashboard/super-admin/whitelist`, unlocking registration for
the rest of the team. Without `SUPER_ADMINS`, any email can sign up.
