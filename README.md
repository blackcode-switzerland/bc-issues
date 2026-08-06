# 🔺 Blackcode Issues

AI-native issue tracking with **two surfaces over one data model**: a web
dashboard for humans, and the `bk` command-line tool for agents and scripts.
Everything is workspace-scoped and built so that humans and the agents working
alongside them can drive the same system.

- **Web** — Next.js 16 App Router dashboard (`/dashboard`)
- **CLI** — `bk`, a Go binary published to npm as `@blackcode_sa/bc-issues`.
  **The only supported programmatic interface.** The REST routes under `/api/*`
  are private plumbing with no public contract — there is no published OpenAPI
  spec (see [`docs/cli.md`](docs/cli.md), and `CLAUDE.md` for why).

### For AI agents

```bash
npm install -g @blackcode_sa/bc-issues
bk login
bk skill install     # writes a ~30-line skill file for your coding agent
bk guide             # the complete usage guide for THIS binary — offline, no auth
bk meta              # your workspaces + live vocabularies + limits
```

`bk guide` ships inside the binary, so it always describes the version you are
running. `bk meta` supplies everything that can change without a release. Those
two are the only sources an agent needs.

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router, React 18, TypeScript strict) |
| Styling | Tailwind v4 (CSS-first, no `tailwind.config`), shadcn-style tokens in `apps/issues/app/globals.css` |
| Data | PostgreSQL via Drizzle ORM (`pg` Pool) |
| Auth | NextAuth (JWT) — email/password + optional Google OAuth; `bk_live_…` API tokens for the CLI/agents |
| Client data | TanStack Query |
| Rich text | TipTap (bubble + floating menus, `@mentions`) |
| Email | Resend (optional — invitations + password-reset OTP) |
| Uploads | Vercel Blob (optional — local `public/uploads` fallback in dev) |

There is **no separate MCP/companion server in this repo** — the `bk` CLI is the
integration surface.

> **This is a monorepo of apps on a shared platform.** The issue tracker is the
> first of several internal Blackcode apps (sales/CRM, bookkeeping, …). Apps live
> in `apps/*`, shared libraries in `packages/platform-*`, the `bk` CLI and `docs/`
> at the root, and Turborepo drives the tasks.
>
> **The platform migration is finished — all nine phases (0–8) landed on
> 2026-08-05.** `packages/platform-{db,api,ui,auth,agent,storage,testing}` exist;
> the database is `platform.*` + `issues.*` (never `public`) with a bounded
> per-app Postgres role; the CLI is namespaced per app (`bk issues issue create`);
> everything is addressable by URN; storage is shared, app-attributed and
> reference-counted across deployments.
>
> | | |
> |---|---|
> | **Add an app** | [`docs/adding-an-app.md`](docs/adding-an-app.md) — the authoritative, walked checklist |
> | **Current design** | [`docs/platform-architecture.md`](docs/platform-architecture.md) |
> | **Why the repo looks like this** | [`docs/2026-08-platform-migration.md`](docs/2026-08-platform-migration.md) |
> | **Remove an app** | [`docs/extracting-an-app.md`](docs/extracting-an-app.md) — rehearsed |
> | **The database boundary** | [`docs/platform-db.md`](docs/platform-db.md) |
>
> Read those before starting a second app or changing
> `apps/issues/lib/db/schema.ts`, `apps/issues/lib/api/`, `apps/issues/lib/auth/`,
> `packages/platform-*` or `cli/`.

## Quick start

### 1. Database

A `docker-compose.yml` boots Postgres 16 on **`localhost:5434`** (db
`blackcode_issues`, user `blackcode`, password `blackcode_dev`):

```bash
docker compose up -d
```

(Any reachable Postgres works — just point `DATABASE_URL` at it.)

### 2. Environment

Create **`apps/issues/.env.local`** (see [`ENV_TEMPLATE.md`](ENV_TEMPLATE.md) for
the full list). It lives inside the app workspace, not at the repo root — Next
and `drizzle.config.ts` both read it relative to `apps/issues/`.

The minimum to boot:

```env
DATABASE_URL=postgres://blackcode:blackcode_dev@localhost:5434/blackcode_issues
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=$(openssl rand -base64 32)
```

Google OAuth, Resend email, and Vercel Blob are all **optional** — the app runs
without them (email falls back to the in-app inbox + copyable links; uploads go
to the local filesystem).

### 3. Install, migrate, run

All commands run from the **repo root** — this is an npm-workspaces + Turborepo
monorepo, and the root scripts delegate into `apps/issues`.

```bash
npm install
npm run db:migrate    # apply Drizzle migrations in apps/issues/lib/db/migrations/
npm run dev
```

Visit **http://localhost:3000**. Sign up with email/password, and you'll be
prompted to create your first workspace.

> The `scripts/*.sql` files are legacy one-shot dumps. The source of truth for
> the schema is `apps/issues/lib/db/schema.ts`; migrations are managed by `drizzle-kit`
> (`npm run db:generate` to author one, `npm run db:migrate` to apply).

## What's in the box

- **Workspaces** — multi-tenant; every row is `workspace_id`-scoped. Owner +
  member roles. Issue IDs are a per-workspace sequence. **Move or copy**
  projects/tasks/issues between two workspaces you belong to — one atomic
  transaction, fresh #numbers, labels/comments/attachments carried, no data
  loss (`bk issues move` / `bk issues copy`, `POST /api/workspaces/{ws}/move`).
- **Projects** — status, priority, lead, members, labels, start/target dates,
  icon, and a **status-update feed** (health: on-track / at-risk / off-track).
- **Issues** — workspace sequence IDs, priority, status, assignee, labels,
  task, due dates, watchers, rich-text description, comments with
  `@mentions`, and attachments. Standalone issues (no project) are allowed.
- **Tasks** — workspace- or project-scoped, with their own issues and
  comments.
- **Labels** — defined at the workspace level, applied to issues and projects.
- **Activity & inbox** — every mutation writes to an append-only event spine
  (`events`), which fans out into a per-user `inbox` and the activity feed.
- **Analytics** — workspace / project / task / member views, with a
  print-to-PDF page.
- **Trash** — issues, tasks and projects soft-delete into a recoverable Trash;
  items deleted together restore as a group. (`bk undo` was removed in 1.12.0 —
  it never recorded anything. Trash is the working undo and always was.)
- **Reliability** — server-side error tracking with a public `/status` page.

## API at a glance

Workspace-scoped routes are canonical:

```
/api/workspaces/{ws}/projects            GET, POST
/api/workspaces/{ws}/projects/{id}       GET, PATCH, DELETE
/api/workspaces/{ws}/projects/{id}/updates       GET, POST    # status updates
/api/workspaces/{ws}/issues              GET, POST
/api/workspaces/{ws}/issues/{id}         GET, PATCH, DELETE
/api/workspaces/{ws}/tasks …        GET, POST, PATCH, DELETE
/api/workspaces/{ws}/labels …            GET, POST, DELETE
/api/workspaces/{ws}/members …           GET, DELETE
/api/workspaces/{ws}/invitations …       GET, POST, DELETE
/api/workspaces/{ws}/activity            GET
/api/workspaces/{ws}/analytics           GET
/api/workspaces/{ws}/move                POST         # copy/move items to another workspace
```

Personal/auth routes live under `/api/me/*`, `/api/auth/*`, `/api/tokens/*`,
`/api/cli/authorize`, `/api/upload`, `/api/meta`, `/api/changelog` and
`/api/status`.

**The legacy non-workspace shims are gone.** `/api/projects`, `/api/issues`,
`/api/tasks` and `/api/activity` were removed with the platform migration —
everything tenant-scoped lives under `/api/workspaces/{ws}/…`, and
implicit-active-workspace routes are not to be reintroduced. `/api/users`
remains. `/api/undo`, `/api/openapi.json` and `/api/docs` remain as **410 Gone**
stubs carrying a `suggestion`, deliberately and indefinitely — a 410 an old
client can act on beats a 404 that looks like a bug.

Full detail in [`docs/backend.md`](docs/backend.md).

`{ws}` accepts either a workspace **slug** or numeric **id** — prefer the slug
(the numeric id is opaque; agents choose a workspace by name/slug from
`bk meta`'s `workspaces` list, never by id).

## Authentication

- **Browser** — NextAuth session cookie. Email/password (bcrypt) by default;
  Google OAuth if `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set.
- **API tokens** — minted in Settings → Tokens or via the `bk login` browser
  flow, and sent by the CLI automatically. Stored as a SHA-256 hash; shown once.
  Token creation and revocation are session-only, so a leaked token can't mint
  more.
- **Password reset** — OTP emailed via Resend; resetting a password invalidates
  existing browser sessions (API tokens are unaffected).

## Documentation

**Root `docs/` is the platform and the monorepo. `apps/<app>/docs/` is that app.**
Root docs never describe an app's internals; an app's docs never describe another
app.

| Doc | What it covers |
|-----|----------------|
| [`docs/adding-an-app.md`](docs/adding-an-app.md) | **Start here to add an app.** The authoritative, self-contained checklist |
| [`docs/platform-architecture.md`](docs/platform-architecture.md) | Current design: the boundary rule, URNs, the access model, separation rules |
| [`docs/2026-08-platform-migration.md`](docs/2026-08-platform-migration.md) | Why the repo looks like this, what it cost, and what is still owed |
| [`docs/platform-db.md`](docs/platform-db.md) | The database boundary, the two credentials, roles and grants |
| [`docs/extracting-an-app.md`](docs/extracting-an-app.md) | Removing an app — rehearsed, including the trap that fails silently |
| [`docs/backend.md`](docs/backend.md) | **Platform.** Shared API conventions, auth, `platform.*` schema, the event spine, the blob index |
| [`docs/frontend.md`](docs/frontend.md) | **Platform.** Theme + tokens, `components/ui/` primitives, app shell, data fetching |
| [`docs/cli.md`](docs/cli.md) | **Maintainer doc** for the `bk` CLI — build, release, internals. Usage lives in `bk guide` |
| [`docs/devops.md`](docs/devops.md) | Releases, deploys, migrations, env vars, the operational rules |
| [`docs/env.md`](docs/env.md) | Environment variable reference |
| [`cli/internal/guide/topics/`](cli/internal/guide/topics) | The agent-facing usage guide, embedded in the binary and served by `bk guide` |
| [`docs/changelog/`](docs/changelog/) | The dated record of every change — one file per app plus `platform.md`, merged into one feed by `bk changelog` and `GET /api/changelog` |
| [`docs/sql/`](docs/sql/) | Role creation, the app-boundary probe, per-phase rollback scripts |
| [`apps/issues/docs/`](apps/issues/docs/) | The issues app only — its domain model, routes, UI patterns, and marketing content |
| `docs/architecture-rebuild.md`, `docs/specs/*`, `docs/next-fixes.md`, `docs/migration/*` | **Historical.** Point-in-time records, each carrying a dated superseded note. Do not follow as instructions |

## Deployment

Designed for Vercel. Set `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, and
any optional integrations (`GOOGLE_*`, `RESEND_*`, `BLOB_READ_WRITE_TOKEN`) as
environment variables, then run `npm run db:migrate` against the production
database. Vercel auto-deploys on push.
