# Backend

End-to-end reference for the blackcode-issues API: every route, the full database schema, the auth model, and the helper layer underneath.

---

## Table of contents

1. [Stack](#stack)
2. [Architecture at a glance](#architecture-at-a-glance)
3. [Authentication & authorization](#authentication--authorization)
4. [Database schema](#database-schema)
5. [API reference](#api-reference)
6. [Query layer (`lib/db/queries/`)](#query-layer-libdbqueries)
7. [Cross-cutting concerns](#cross-cutting-concerns)
8. [Adding new functionality](#adding-new-functionality)
9. [Operational notes](#operational-notes)

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Route Handlers) |
| Language | TypeScript (strict) |
| Database | PostgreSQL 16 (Docker locally, Vercel/Neon Postgres in prod) |
| ORM | drizzle-orm + drizzle-kit |
| Driver | `pg` (node-postgres, pool of 10) |
| Auth (session) | NextAuth v4 — JWT strategy |
| Auth (programmatic) | API tokens — `bk_live_…`, SHA-256 hashed |
| Password hashing | bcryptjs (12 rounds) |
| File storage | Vercel Blob (production) or local `public/uploads/` (development) |

Configuration is read from `.env.local` for development and from the host's environment in production. The only required variables are `DATABASE_URL`, `NEXTAUTH_URL`, and `NEXTAUTH_SECRET`. Google OAuth (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) is optional; the credentials provider works without it. `BLOB_READ_WRITE_TOKEN` enables Vercel Blob; without it, dev falls back to local disk and production returns an error.

---

## Architecture at a glance

```
Client (browser / CLI / agent)
        │
        │ HTTPS — Authorization: Bearer …, or NextAuth session cookie
        ▼
┌──────────────────────────────────────────────────┐
│ Next.js App Router — app/api/**/route.ts         │
│                                                  │
│   resolveUser(req)  ← lib/auth/resolve.ts        │
│       │                                          │
│       ├─ Bearer token? → verifyToken(...)        │
│       └─ Session cookie? → getServerSession(...) │
│                                                  │
│   Permission checks (project membership, role)   │
│   Validation / coercion                          │
│   ↓                                              │
│   lib/db/queries/* — typed helpers (drizzle)     │
│   ↓                                              │
│   pg.Pool → PostgreSQL                           │
└──────────────────────────────────────────────────┘
```

Every API route follows the same skeleton:

1. `resolveUser(request)` — unifies session and token auth.
2. Permission check — project membership, role, ownership.
3. Input validation — JSON body, query params.
4. Domain operation — call into `lib/db/queries/<resource>`.
5. Audit (optional) — write to `transaction_log` for undo-able mutations.
6. Return `NextResponse.json(...)` with the appropriate status.

---

## Authentication & authorization

### Two ways to authenticate

| Method | How it's sent | Best for |
|---|---|---|
| **NextAuth session** | HTTP-only session cookie set by `/api/auth/[...nextauth]` | Browser users |
| **API token** | `Authorization: Bearer bk_live_…` header | CLIs, scripts, agents |

`lib/auth/resolve.ts` resolves both transparently:

```ts
const result = await resolveAuth(req)  // { user, via: 'session' | 'token' } | null
const user   = await resolveUser(req)  // User | null  (convenience wrapper)
```

If the `Authorization` header begins with `Bearer `, the token path is taken (and the session is ignored, even if present). Otherwise the session is consulted.

### NextAuth (`lib/auth.ts`)

- **Strategy**: JWT (stateless). No DB-backed sessions; the JWT contains the user's id and role.
- **Providers**:
  - **Google OAuth** — included only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. On `signIn`, the user is upserted via `upsertUserFromOAuth`.
  - **Credentials** — email + password. Looks up `users.password_hash`, verifies with bcryptjs.
- **Callbacks**:
  - `signIn` — for Google, upserts the user record.
  - `jwt` — on first sign-in, attaches `id` and `role` to the JWT.
  - `session` — copies `id`/`role` into `session.user` so client code can use them.
- **Pages**: `signIn` and error → `/login`.

`authOptions` lives in `lib/auth.ts` so multiple call sites (the route handler and `getServerSession`) can import it. **Do not** import it from the API route file; that breaks the build under recent Next.js.

### API tokens (`lib/auth/tokens.ts`)

- Format: `bk_live_<32 base64url bytes>`.
- Stored as **SHA-256 hex hash** plus an 8-character plaintext **prefix** (so the UI can show "bk_live_abc12345…" without storing the secret).
- `scopes` is an array, defaulting to `['full']`. Scope-aware checks aren't currently enforced, but the column exists for future per-scope tokens.
- `expires_at` is optional. Expired tokens fail `verifyToken`.
- Functions: `mintToken({ user_id, name, scopes?, expires_at? })`, `verifyToken(plaintext)`, `listTokens(user_id)`, `revokeToken(user_id, token_id)`.

Token minting happens through two paths:

1. **Web UI** — `POST /api/tokens` (session-only) returns the plaintext once.
2. **CLI flow** — `POST /api/cli/authorize` (session-only) mints a token then redirects the browser back to a loopback URL the CLI is listening on, embedding the token in the query string. See [the CLI doc](./cli.md) for the other side of the handshake.

### Roles

User-level (`users.role`):
- `member` (default)
- `admin` — required by admin-only routes (`/api/analytics`, `/api/seed`).

Project-level (`project_members.role`):
- `owner` — can do anything in the project, including delete and transfer.
- `admin` — can manage members, delete issues.
- `member` — full read/write on issues, comments, attachments.
- `viewer` — read-only.

Helpers in `lib/db/queries/members.ts`: `isProjectMember`, `getProjectMemberRole`.

### Admin bootstrap

`POST /api/admin/promote` is a one-shot endpoint that promotes user id 1 to `admin`. It exists so a fresh deploy has at least one admin without requiring DB access. After the first admin exists, the endpoint refuses to mint more.

---

## Database schema

PostgreSQL 16, defined in `lib/db/schema.ts`. Migrations live in `lib/db/migrations/`. Apply them with `npm run db:migrate`.

### `users`

The user identity table. Populated by Google OAuth, credentials sign-up, or seed data.

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | |
| `google_id` | `varchar` unique nullable | OAuth subject id |
| `email` | `varchar(255)` unique NOT NULL | |
| `name` | `varchar(255)` nullable | |
| `avatar_url` | `text` nullable | |
| `password_hash` | `varchar(255)` nullable | bcrypt; `null` for OAuth-only users |
| `role` | `varchar(50)` default `'member'` | `'member' \| 'admin'` |
| `last_login` | `timestamptz` nullable | updated on credentials login |
| `created_at`, `updated_at` | `timestamptz` | |

### `projects`

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | |
| `name` | `varchar(100)` NOT NULL | |
| `description` | `text` nullable | |
| `status` | `varchar(50)` default `'active'` | |
| `owner_id` | `int` FK → `users.id` ON DELETE SET NULL | |
| `priority` | `varchar(10)` default `'P2'` | |
| `visibility` | `varchar(20)` default `'team'` | |
| `color`, `icon_url`, `banner_url` | | |
| `start_date`, `end_date` | `date` nullable | |
| `created_at`, `updated_at` | `timestamptz` | |

### `project_members`

Many-to-many between users and projects, with role.

| Column | Notes |
|---|---|
| `id` | PK |
| `project_id` FK → `projects.id` ON DELETE CASCADE | |
| `user_id` FK → `users.id` ON DELETE CASCADE | |
| `role` | `'owner' \| 'admin' \| 'member' \| 'viewer'` |
| `joined_at` | |
| Unique on `(project_id, user_id)` | |

### `milestones`

| Column | Notes |
|---|---|
| `id` PK | |
| `project_id` FK → `projects.id` CASCADE | |
| `name`, `description`, `due_date`, `status` | |
| Index on `project_id` | |

### `issues`

The core entity.

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | |
| `project_id` | FK → `projects.id` CASCADE | |
| `milestone_id` | FK → `milestones.id` SET NULL | |
| `title` | `varchar(200)` NOT NULL | |
| `description` | `text` | HTML produced by TipTap, sanitized client-side |
| `status` | `varchar(50)` default `'backlog'` | `'backlog' \| 'todo' \| 'in_progress' \| 'blocked' \| 'in_review' \| 'done' \| 'cancelled'` |
| `priority` | `int` 1–5, default 3 | 1 = urgent, 5 = none |
| `assignee_id` | FK → `users.id` SET NULL | |
| `reporter_id` | FK → `users.id` SET NULL | |
| `start_date`, `due_date` | `date` nullable | |
| `estimated_hours` | `decimal(5,1)` nullable | |
| `created_at`, `updated_at` | | |

Indexes: `project`, `status`, `assignee`, `milestone`, `priority`.

### `comments`

| Column | Notes |
|---|---|
| `id` PK | |
| `issue_id` FK → `issues.id` CASCADE | |
| `user_id` FK → `users.id` SET NULL | |
| `content` `text` NOT NULL | HTML allowed |
| `created_at`, `updated_at` | |

### `attachments`

| Column | Notes |
|---|---|
| `id` PK | |
| `issue_id` FK → `issues.id` CASCADE | |
| `filename`, `file_url`, `file_size`, `mime_type` | |
| `uploaded_by` FK → `users.id` SET NULL | |

### `labels` and `issue_labels`

Project-scoped labels with a junction table. The label schema is in place; UI is not wired up yet.

### `transaction_log`

The undo system's substrate. Every undo-able mutation writes one row.

| Column | Notes |
|---|---|
| `id` PK | |
| `user_id` FK → `users.id` SET NULL | who did it |
| `operation_type` | `'INSERT' \| 'UPDATE' \| 'DELETE'` |
| `table_name`, `record_id` | what was touched |
| `old_data`, `new_data` | `jsonb` snapshots |
| `rolled_back` | `boolean` default false |
| `created_at` | |

### `api_tokens`

| Column | Notes |
|---|---|
| `id` PK | |
| `user_id` FK → `users.id` CASCADE | |
| `name` `varchar(100)` | human label |
| `token_hash` `varchar(128)` | SHA-256 hex, **unique** |
| `token_prefix` `varchar(16)` | first 8 chars, for UI display |
| `scopes` `text[]` default `{full}` | |
| `last_used_at`, `expires_at` | |
| Indexes: `user`, `prefix`; unique on `token_hash` | |

---

## API reference

All paths are rooted at `/api`. All responses are JSON. All routes require authentication unless explicitly marked **public**. Auth is satisfied by either a NextAuth session cookie or `Authorization: Bearer bk_live_…`.

### Conventions

- **Pagination** — cursor-based on collection endpoints. Pass `?limit=N&cursor=ID` and receive `{ data, next_cursor }`.
- **Errors** — `{ error: string, suggestion?: string, details?: string }` with appropriate status code.
- **Mutation** — POST creates (201), PATCH partial-updates (200), DELETE removes (200/204).
- **Auth failures** — 401 (missing/invalid auth), 403 (auth ok but role insufficient), 404 (resource doesn't exist or user can't see it).

### Auth

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | **Public**. Body: `{ email, password, name? }`. 201 on success; 409 if email exists. Password 8–200 chars. |
| (NextAuth handler) | `/api/auth/[...nextauth]` | Sign-in/out and OAuth callbacks. |

### Tokens

| Method | Path | Description |
|---|---|---|
| GET | `/api/tokens` | **Session only**. List the caller's tokens (id, prefix, name, expires_at, last_used_at, created_at). |
| POST | `/api/tokens` | **Session only**. Body: `{ name, expires_at? }`. Returns `{ id, plaintext, prefix, ... }` — `plaintext` is shown **once**. |
| DELETE | `/api/tokens/[id]` | **Session only**. Revoke a token. |

### CLI flow

| Method | Path | Description |
|---|---|---|
| POST | `/api/cli/authorize` | **Session required**. Body: `{ callback, state, name? }`. `callback` must be a `127.0.0.1` or `localhost` URL. Mints a token and returns `{ redirect_url, token_id, token_name }`. The browser then redirects to `redirect_url`, which is the CLI's loopback listener. |

### Users

| Method | Path | Description |
|---|---|---|
| GET | `/api/users` | List all users (id, name, email, avatar_url, role). |
| GET | `/api/users/me` | Current user + `via: 'session' \| 'token'`. |

### Projects

| Method | Path | Description |
|---|---|---|
| GET | `/api/projects` | List the caller's projects. Query: `?limit=1-200` and `?cursor=ID` for pagination. Each item carries `issue_count`, `open_issues`, `member_role`. |
| POST | `/api/projects` | Create. Body: `{ name, description? }`. 201; creator becomes `owner` in `project_members`. |
| GET | `/api/projects/[id]` | Detail. 403 if not a member. |
| PATCH | `/api/projects/[id]` | Update. Owner or project admin only. Body keys: `name, description, status, priority, visibility, color, icon_url, banner_url, start_date, end_date, owner_id`. |
| DELETE | `/api/projects/[id]` | **Owner only**. Cascades to members, issues, milestones. |
| GET | `/api/projects/[id]/members` | List. |
| POST | `/api/projects/[id]/members` | Add by email. Owner/admin only. Body: `{ email, role? }`. |
| DELETE | `/api/projects/[id]/members` | Remove. Owner/admin only. Body: `{ user_id }`. |

### Issues

| Method | Path | Description |
|---|---|---|
| GET | `/api/issues` | List. Query: `?project_id=N` to filter; `?limit&cursor` for pagination. Carries `comment_count, attachment_count, assignee_name, milestone_name`. |
| POST | `/api/issues` | Create. Body: `{ project_id, title, description?, status?, priority?, assignee_id?, milestone_id? }`. 201. |
| GET | `/api/issues/[id]` | Detail. 403 if not a member of the project. |
| PATCH | `/api/issues/[id]` | Update. Non-viewer members only. Writes to `transaction_log`. Body keys: `title, description, status, priority, assignee_id, milestone_id, start_date, due_date` (any combination). |
| DELETE | `/api/issues/[id]` | Owner or project admin only. Writes to `transaction_log`. |
| GET | `/api/issues/[id]/comments` | List. |
| POST | `/api/issues/[id]/comments` | Add. Body: `{ content }`. |
| GET | `/api/issues/[id]/attachments` | List with uploader info. |
| POST | `/api/issues/[id]/attachments` | Attach. Body: `{ filename, file_url, file_size?, mime_type? }`. Non-viewers. |
| DELETE | `/api/issues/[id]/attachments?attachmentId=N` | Remove. Uploader or project admin. |
| GET | `/api/issues/[id]/activity` | Merged feed: comments + transaction_log changes, newest first. |

### Milestones

| Method | Path | Description |
|---|---|---|
| GET | `/api/milestones` | List. Optional `?project_id=N`. Carries `issue_count, completed_issues`. |
| POST | `/api/milestones` | Body: `{ project_id, name, description?, due_date? }`. |
| GET | `/api/milestones/[id]` | Detail. `?includeIssues=true` to embed issues. |
| PATCH | `/api/milestones/[id]` | Update. |
| DELETE | `/api/milestones/[id]` | |

### Activity / undo

| Method | Path | Description |
|---|---|---|
| GET | `/api/activity` | Global feed from `transaction_log`. `?limit&offset`. |
| GET | `/api/undo` | The caller's last 50 transactions (for "what could I undo?"). |
| POST | `/api/undo` | Body: `{ count? }` (1–10). Rolls back the caller's last N operations atomically; sets `rolled_back=true`. Returns `{ success, undone_count, operations }`. |

### Analytics

| Method | Path | Description |
|---|---|---|
| GET | `/api/analytics` | **Admin-only**. Returns `{ issuesByStatus, issuesByProject, topAssignees, issuesOverTime }`. |

### Admin & seed

| Method | Path | Description |
|---|---|---|
| POST | `/api/admin/promote` | One-shot. Session must be user id 1 and no admin must exist yet. |
| POST | `/api/seed` | **Admin-only**. Generates demo projects/milestones/issues/comments. |
| POST | `/api/migrate` | **Deprecated** (410). Use `npm run db:migrate` from the host. |

### Uploads

| Method | Path | Description |
|---|---|---|
| GET | `/api/upload` | Info endpoint: describes max size, allowed types. |
| POST | `/api/upload` | `multipart/form-data` with field `file`. Returns `{ url, filename, size, contentType }`. Max 10 MB. Allowed: `image/{jpeg,png,gif,webp}`, `application/pdf`, `text/plain`, `application/json`, `text/markdown`. If `BLOB_READ_WRITE_TOKEN` is set, uploads go to Vercel Blob; otherwise (dev only) files land in `public/uploads/` and are served at `/uploads/<file>`. |

---

## Query layer (`lib/db/queries/`)

Thin, typed wrappers around drizzle. API routes call these instead of writing SQL inline. Each module exports a small set of named functions:

| File | Exports (purpose) |
|---|---|
| `users.ts` | `getUsers`, `getUserById`, `getUserByEmail`, `upsertUserFromOAuth`, `createUserWithPassword`, `touchLastLogin` |
| `projects.ts` | `getProjects`, `getProjectsPage` (cursor), `getProject`, `createProject` (auto-adds creator as owner), `updateProject`, `deleteProject` |
| `members.ts` | `getProjectMembers`, `addProjectMember`, `removeProjectMember`, `isProjectMember`, `getProjectMemberRole` |
| `issues.ts` | `getIssue`, `getIssuesByProject`, `getAllIssuesWithProjects`, `getIssuesPage`, `getIssuesByMilestone`, `getKanbanView`, `createIssue`, `updateIssue`, `deleteIssue` |
| `comments.ts` | `getComments`, `createComment` |
| `attachments.ts` | `getAttachments`, `getAttachment`, `createAttachment`, `deleteAttachment` |
| `milestones.ts` | `getMilestones`, `getAllMilestones`, `getMilestone`, `getMilestoneWithDetails`, `createMilestone`, `updateMilestone`, `deleteMilestone` |
| `activity.ts` | `getIssueActivity`, `getActivityFeed`, `getTransactionLog`, `logTransaction`, `undoLastOperations` |
| `analytics.ts` | `getAnalytics` (four sub-queries: status, top projects, top assignees, time series) |
| `transaction.ts` | low-level transaction-log helpers |

`lib/db.ts` re-exports everything so routes can import from a single path.

`lib/db/client.ts` holds the singleton `pg.Pool` (max 10) and the drizzle wrapper. It caches both on `globalThis` in development so hot reloads don't leak connections.

---

## Cross-cutting concerns

### Middleware (`middleware.ts`)

NextAuth's `withAuth` guards `/dashboard/*`. Unauthenticated requests are redirected to `/login`. API routes do their own auth via `resolveUser`.

> **Note**: Next 16 emits `The "middleware" file convention is deprecated. Please use "proxy" instead.` Not blocking; rename to `proxy.ts` when convenient.

### Transaction log / undo

Mutations to `issues` (PATCH and DELETE) call `logTransaction({ user_id, operation_type, table_name, record_id, old_data, new_data })`. The `/api/undo` endpoint reads the caller's most recent rows where `rolled_back = false`, applies the reverse, and marks the rows as rolled back so they don't fire again.

`UPDATE`s restore `old_data` field-by-field. `INSERT`s delete the inserted row. `DELETE`s currently aren't fully reversible for issues (the row's children — comments, attachments — cascade-delete) and the endpoint is intentionally limited to the simple cases.

### File uploads

`app/api/upload/route.ts` is the central upload endpoint. Two storage backends:

| `BLOB_READ_WRITE_TOKEN` set | Where the file lands |
|---|---|
| Yes | Vercel Blob, public URL returned (https://...) |
| No, dev mode | `public/uploads/<timestamp-name>-<random>.<ext>`; URL is `/uploads/...` |
| No, prod mode | 500 with `error: 'Blob storage not configured'` |

This last branch is intentional: silently falling back to the local FS in production would write files to an ephemeral container.

Sanitization: filename is reduced to `[A-Za-z0-9.-]`, prefixed with `Date.now()`, suffixed with random hex. Path is resolved and asserted to remain inside `public/uploads/` as a defense in depth.

### Password hashing

`lib/auth/password.ts`:
- `hashPassword(plain) → string` — bcryptjs with 12 rounds.
- `verifyPassword(plain, hash) → boolean`.
- `validateEmail`, `validatePassword` — simple guards used at registration.

### Error responses

Routes return shapes like:

```json
{ "error": "Invalid name", "suggestion": "Provide a non-empty `name` field" }
{ "error": "Unauthorized" }
{ "error": "Forbidden", "details": "Owner or admin role required" }
```

The CLI parses these into `client.APIError` and maps to stable exit codes (see [CLI doc](./cli.md)).

---

## Adding new functionality

### A new API endpoint

1. Decide whether it belongs to an existing resource (`/api/issues/[id]/...`) or a new one.
2. Create `app/api/<path>/route.ts` exporting `GET`/`POST`/`PATCH`/`DELETE`.
3. Inside, follow the standard skeleton:
   ```ts
   import { resolveUser } from '@/lib/auth/resolve'

   export async function POST(request: NextRequest) {
     const user = await resolveUser(request)
     if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

     // permission check (membership / role) …

     const body = await request.json().catch(() => ({}))
     // validate body …

     const result = await someQuery(...)
     return NextResponse.json(result, { status: 201 })
   }
   ```
4. If the operation is reversible and meaningful, add a `logTransaction(...)` call.
5. Add or extend a `lib/db/queries/<resource>.ts` helper rather than putting SQL in the route.

### A new column

1. Edit `lib/db/schema.ts` — add the column with the appropriate drizzle type.
2. `npm run db:generate` to produce a new migration in `lib/db/migrations/`.
3. Inspect the generated SQL, edit if needed (e.g. add a default to avoid blocking on existing rows).
4. `npm run db:migrate` to apply.
5. Update any query helpers that select the table.

### A new table

Same as a column, plus update relations in `schema.ts` and add a new `lib/db/queries/<table>.ts` file with the basic CRUD helpers.

### A new auth-protected resource

If the resource is owned by a project, use `isProjectMember(user.id, project_id)` and `getProjectMemberRole(...)` for checks. If it's user-scoped (like tokens), constrain by `user_id` in every query.

---

## Operational notes

### Local development

```bash
docker compose up -d     # postgres on :5434
npm run dev              # next.js on :3000
```

The DB persists in the `bkcli-test_pgdata` Docker volume.

### Migrations

```bash
npm run db:generate      # diff schema vs migrations, write new file
npm run db:migrate       # apply pending migrations
npm run db:push          # (use with care) push schema without migrations
npm run db:studio        # drizzle's table browser
```

### Seeding

`POST /api/seed` (admin only) populates demo data. Convenient for local QA.

### Bootstrapping an admin

After registering the very first user, hit `POST /api/admin/promote` (from a logged-in browser console: `fetch('/api/admin/promote', { method: 'POST' })`). Subsequent admins can be created by editing `users.role` directly or via a future admin UI.

### Backups

Postgres-level — `pg_dump` against `DATABASE_URL`. Vercel Postgres / Neon both expose this in their dashboards. Local: `docker exec blackcode-postgres pg_dump -U blackcode blackcode_issues > backup.sql`.
