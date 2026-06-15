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
| `workspaces` | `name`, `slug` (unique), `key` (unique, 6-char issue prefix), `owner_id`, `logo_url`, `deleted_at` |
| `workspace_members` | `(workspace_id, user_id)` unique; `role` ∈ `owner` \| `member` |
| `workspace_counters` | `last_issue_seq` — per-workspace issue sequence allocator |
| `workspace_invitations` | `email`, `token` (unique), `role`, `status` ∈ `pending`/`accepted`/`revoked`/`expired`/`declined`, `expires_at` |
| `api_tokens` | `token_hash` (unique), `token_prefix`, `scopes` (default `['full']`), `expires_at`, `last_used_at` |
| `password_reset_otps` | `email`, `otp_hash`, `expires_at`, `consumed_at`, `attempts` |
| `email_whitelist` | Platform access control (migration `0023`). `type` ∈ `email` \| `domain`; `value` is the address or domain; `added_by` FK to users. Active only when `SUPER_ADMINS` env var is set. |

### Work items

| Table | Purpose / notable columns |
|-------|---------------------------|
| `projects` | `workspace_id`, `name`, `status`, `priority` (`P0`–`P4`), `owner_id` (lead), `color`, `icon`, `start_date`, `end_date` |
| `project_updates` | status-update feed; `status` ∈ `on_track`/`at_risk`/`off_track`, rich-text `body`, `author_id`. Latest row = project's current health |
| `milestones` | `workspace_id`, optional `project_id` (ON DELETE SET NULL — milestones can be standalone), `due_date`, `status` |
| `issues` | `workspace_id`, `seq` (unique per workspace), optional `project_id`/`milestone_id`, `title`, `status`, `priority` (int 1–5, checked), `reporter_id`, `start_date`/`due_date`, `estimated_hours`, `completed_at`/`cancelled_at`. **No `assignee_id` — see `issue_assignees`** |
| `issue_assignees` | many-to-many junction: `(issue_id, user_id)` composite PK; `assigned_at`. Replaces the old single `assignee_id` column so issues can have multiple assignees. Both FKs cascade on delete |
| `comments` | **polymorphic**: `parent_type` ∈ `issue`/`milestone`/`project` + `parent_id`; `content`, `mentions` (int[]), `edited_at`. Legacy `issue_id` retained for one release |
| `attachments` | `issue_id`, `filename`, `file_url`, `file_size`, `mime_type`, `uploaded_by` |
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

This single spine is read by:

- **Activity feed** (`activity.ts`, `/api/workspaces/{ws}/activity`),
- **Inbox** (`inbox.ts`, `/api/me/inbox`),
- **Analytics** (`analytics.ts`).

### Analytics contract (`analytics.ts`)

`computeAnalytics(input)` returns one `AnalyticsPayload` for the requested
**view** (`workspace` | `project` | `milestone` | `member`) + optional target
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
`aging_buckets`), `activity_by_action`, `top_active_members`, and — milestone
view only — `burndown_series` (`remaining` vs. a straight-line `ideal`).

## API reference

### Conventions

- All handlers are wrapped in `apiHandler`. Mutations validate input and throw
  `Errors.badRequest(...)` on bad shapes.
- Workspace-scoped routes resolve `{ ws }` (slug **or** numeric id) via
  `resolveWorkspace`.
- List endpoints that paginate return `{ data, next_cursor }`; simple lists
  return `{ data }`.

### Workspace-scoped (canonical)

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

GET    /api/workspaces/{ws}/projects            list projects
POST   /api/workspaces/{ws}/projects            create project
GET    /api/workspaces/{ws}/projects/{id}       project detail (+ members, labels)
PATCH  /api/workspaces/{ws}/projects/{id}       update (also member_ids/label_ids)
GET    /api/workspaces/{ws}/projects/{id}?preview=1   child counts for delete dialog
DELETE /api/workspaces/{ws}/projects/{id}?mode=cascade|detach   move to Trash (default: detach)
GET    /api/workspaces/{ws}/projects/{id}/comments   list / POST comment
GET    /api/workspaces/{ws}/projects/{id}/updates    list status updates
POST   /api/workspaces/{ws}/projects/{id}/updates    post update (status + body)
DELETE /api/workspaces/{ws}/projects/{id}/updates/{updateId}   delete (author)
POST   /api/workspaces/{ws}/projects/reorder    update display order (drag-and-drop)

GET    /api/workspaces/{ws}/milestones          list / POST create
GET    /api/workspaces/{ws}/milestones/{id}?preview=1   child counts for delete dialog
PATCH  /api/workspaces/{ws}/milestones/{id}     update
DELETE /api/workspaces/{ws}/milestones/{id}?mode=cascade|detach   move to Trash (default: detach)
GET    /api/workspaces/{ws}/milestones/{id}/comments  list / POST

GET    /api/workspaces/{ws}/issues              list (filters) / POST create
GET    /api/workspaces/{ws}/issues/{id}         detail / PATCH
DELETE /api/workspaces/{ws}/issues/{id}         move to Trash
GET    /api/workspaces/{ws}/issues/{id}/comments     list / POST
GET    /api/workspaces/{ws}/issues/{id}/labels       list / POST attach
DELETE /api/workspaces/{ws}/issues/{id}/labels/{lid} detach
POST   /api/workspaces/{ws}/issues/{id}/watch        watch / DELETE unwatch
POST   /api/workspaces/{ws}/issues/reorder      update display order (drag-and-drop)

GET    /api/workspaces/{ws}/labels              list / POST create
PATCH  /api/workspaces/{ws}/labels/{id}         update / DELETE
DELETE /api/workspaces/{ws}/comments/{id}       edit/delete a comment (author)

GET    /api/workspaces/{ws}/activity            activity feed
GET    /api/workspaces/{ws}/analytics           analytics (view/target/range/interval/filters)

GET    /api/workspaces/{ws}/trash               list binned items (?type=issue|project|milestone)
POST   /api/workspaces/{ws}/trash/restore       restore items ({items:[{type,id}]|batch_id, dry_run?, resolutions?})
DELETE /api/workspaces/{ws}/trash/purge         permanent delete — owner only ({items|batch_id})
POST   /api/workspaces/{ws}/trash/empty         hard-delete everything in the bin — owner only
```

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

GET      /api/me                                current user (+ active_workspace_id)
GET      /api/me/workspaces                      my workspaces
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

POST     /api/upload                              file upload (Blob or local)
GET/POST /api/undo                                transaction history / rollback
GET      /api/status                              public health probe
GET      /api/status/errors , /errors/{id}        error log (owner-gated detail)
POST     /api/errors/client                       client error beacon
```

### Legacy non-workspace shims

`/api/projects`, `/api/issues`, `/api/milestones`, `/api/users`,
`/api/activity`, `/api/analytics` (and their `/{id}` children) remain for the
`bk` CLI, which still uses several of them. They resolve the workspace
server-side from the caller. New web code should prefer the workspace-scoped
routes.

`/api/analytics` accepts the **same** query params as the canonical
`/api/workspaces/{ws}/analytics` (both share `parseAnalyticsParams`): `view`,
`id`, `from`, `to`, `interval`, and the `status`/`priority`/`label`/`assignee`
filters — so the CLI (`bk analytics`) has full dashboard parity. It defaults to
the caller's active workspace; pass `?ws=<slug|id>` (or `?workspace=`) to target
another workspace the caller belongs to.

## Query layer

Everything that touches the database lives in `lib/db/queries/`. Routes call
these; they never write SQL inline.

| File | Responsibility |
|------|----------------|
| `workspaces.ts` | workspace CRUD, membership, `getWorkspaceForUser`, issue-seq allocation |
| `members.ts` | project member listing |
| `invitations.ts` | invite CRUD, token mint, accept/decline, pre-signup materialization |
| `users.ts` | user CRUD, `getVisibleUsers` (workspace-mates only — privacy guard), OAuth upsert, password sign-up |
| `projects.ts` | project CRUD; list joins lead + latest update health |
| `project-relations.ts` | project ↔ member and project ↔ label sets |
| `project-updates.ts` | status-update feed (on_track/at_risk/off_track) |
| `milestones.ts` | milestone CRUD (project optional) |
| `issues.ts` | issue CRUD, seq allocation, field-level events, auto-watchers |
| `comments.ts` | polymorphic comments + `@email` mention resolution |
| `labels.ts` | workspace labels; case-insensitive unique names |
| `attachments.ts` | issue attachments |
| `watchers.ts` | issue watchers (manual/assigned/reporter) |
| `events.ts` | the event spine — `recordEvent`, `EntityType`/`EventAction` |
| `fanout.ts` | event → per-user inbox materialization |
| `inbox.ts` | inbox writes (dedup window) + listing |
| `activity.ts` | activity feed reads |
| `analytics.ts` | workspace/project/milestone/member analytics — see below |
| `deletion.ts` | soft-delete engine — `softDelete*`, `previewDeletion`, `listTrash`, `previewRestore`, `restoreItems/Batch`, `purgeItems/Batch`, `emptyTrash` |
| `transaction.ts` | transaction log + `undoLastOperations` |
| `error-events.ts` | error log reads (public list redacts; detail is gated) |
| `password-reset.ts` | OTP issue/verify/consume |
| `whitelist.ts` | `isEmailAllowedByDb`, `listWhitelist`, `addWhitelistEntry`, `removeWhitelistEntry` |
| `admin.ts` | `listAllPlatformUsers` — cross-workspace user listing for super admin view |

## Cross-cutting concerns

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

### File uploads (`app/api/upload/route.ts`)

Requires an authenticated user. If `BLOB_READ_WRITE_TOKEN` is set, stores via
**Vercel Blob**; otherwise writes to `public/uploads/` for local dev. Validates
size (≤10 MB) and MIME type (common images minus SVG, plus pdf/text/json/md).
Returns `{ url, filename, size, contentType }`.

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
