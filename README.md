# 🔺 Blackcode Issues

AI-native issue tracking with **three surfaces over one data model**: a web
dashboard, an HTTP API, and the `bk` command-line tool. Everything is
workspace-scoped and built so that humans and the agents working alongside them
can drive the same system.

- **Web** — Next.js 16 App Router dashboard (`/dashboard`)
- **API** — workspace-scoped REST under `/api/*`
- **CLI** — `bk`, a Go binary that talks to the same API (see [`docs/cli.md`](docs/cli.md))

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router, React 18, TypeScript strict) |
| Styling | Tailwind v4 (CSS-first, no `tailwind.config`), shadcn-style tokens in `app/globals.css` |
| Data | PostgreSQL via Drizzle ORM (`pg` Pool) |
| Auth | NextAuth (JWT) — email/password + optional Google OAuth; `bk_live_…` API tokens for the CLI/agents |
| Client data | TanStack Query |
| Rich text | TipTap (bubble + floating menus, `@mentions`) |
| Email | Resend (optional — invitations + password-reset OTP) |
| Uploads | Vercel Blob (optional — local `public/uploads` fallback in dev) |

There is **no separate MCP/companion server in this repo** — the API itself is
the integration surface. See [`docs/architecture-rebuild.md`](docs/architecture-rebuild.md)
for the historical design record.

## Quick start

### 1. Database

A `docker-compose.yml` boots Postgres 16 on **`localhost:5434`** (db
`blackcode_issues`, user `blackcode`, password `blackcode_dev`):

```bash
docker compose up -d
```

(Any reachable Postgres works — just point `DATABASE_URL` at it.)

### 2. Environment

Create `.env.local` (see [`ENV_TEMPLATE.md`](ENV_TEMPLATE.md) for the full list).
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

```bash
npm install
npm run db:migrate    # apply Drizzle migrations in lib/db/migrations/
npm run dev
```

Visit **http://localhost:3000**. Sign up with email/password, and you'll be
prompted to create your first workspace.

> The `scripts/*.sql` files are legacy one-shot dumps. The source of truth for
> the schema is `lib/db/schema.ts`; migrations are managed by `drizzle-kit`
> (`npm run db:generate` to author one, `npm run db:migrate` to apply).

## What's in the box

- **Workspaces** — multi-tenant; every row is `workspace_id`-scoped. Owner +
  member roles. Issue IDs are a per-workspace sequence.
- **Projects** — status, priority, lead, members, labels, start/target dates,
  icon, and a **status-update feed** (health: on-track / at-risk / off-track).
- **Issues** — workspace sequence IDs, priority, status, assignee, labels,
  milestone, due dates, watchers, rich-text description, comments with
  `@mentions`, and attachments. Standalone issues (no project) are allowed.
- **Milestones** — workspace- or project-scoped, with their own issues and
  comments.
- **Labels** — defined at the workspace level, applied to issues and projects.
- **Activity & inbox** — every mutation writes to an append-only event spine
  (`events`), which fans out into a per-user `inbox` and the activity feed.
- **Analytics** — workspace / project / milestone / member views, with a
  print-to-PDF page.
- **Undo** — a transaction log backs `bk undo` and the `/api/undo` endpoint.
- **Reliability** — server-side error tracking with a public `/status` page.

## API at a glance

Workspace-scoped routes are canonical:

```
/api/workspaces/{ws}/projects            GET, POST
/api/workspaces/{ws}/projects/{id}       GET, PATCH, DELETE
/api/workspaces/{ws}/projects/{id}/updates       GET, POST    # status updates
/api/workspaces/{ws}/issues              GET, POST
/api/workspaces/{ws}/issues/{id}         GET, PATCH, DELETE
/api/workspaces/{ws}/milestones …        GET, POST, PATCH, DELETE
/api/workspaces/{ws}/labels …            GET, POST, DELETE
/api/workspaces/{ws}/members …           GET, DELETE
/api/workspaces/{ws}/invitations …       GET, POST, DELETE
/api/workspaces/{ws}/activity            GET
/api/workspaces/{ws}/analytics           GET
```

Personal/auth routes live under `/api/me/*`, `/api/auth/*`, `/api/tokens/*`,
`/api/cli/authorize`, `/api/upload`, `/api/undo`, and `/api/status`. A set of
legacy non-workspace shims (`/api/projects`, `/api/issues`, `/api/milestones`,
`/api/users`, `/api/activity`) remain for the CLI. Full detail in
[`docs/backend.md`](docs/backend.md).

`{ws}` accepts either a workspace **slug** or numeric **id**.

## Authentication

- **Browser** — NextAuth session cookie. Email/password (bcrypt) by default;
  Google OAuth if `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set.
- **API tokens** — `Authorization: Bearer bk_live_…`, minted in
  Settings → Tokens or via the `bk login` browser flow. Stored as a SHA-256
  hash; shown once.
- **Password reset** — OTP emailed via Resend; resetting a password invalidates
  existing browser sessions (API tokens are unaffected).

## Documentation

| Doc | What it covers |
|-----|----------------|
| [`docs/backend.md`](docs/backend.md) | Schema, auth, API surface, query layer, operations |
| [`docs/frontend.md`](docs/frontend.md) | Routes, theme system, shared components, data fetching |
| [`docs/cli.md`](docs/cli.md) | The `bk` CLI — full command reference |
| [`docs/cli-sync.md`](docs/cli-sync.md) | Keeping the CLI in sync with API changes |
| [`docs/marketing.md`](docs/marketing.md) | Positioning, feature catalog, voice |
| `docs/architecture-rebuild.md`, `HANDOVER.md`, `docs/specs/*` | Historical design/planning records (point-in-time) |

## Deployment

Designed for Vercel. Set `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, and
any optional integrations (`GOOGLE_*`, `RESEND_*`, `BLOB_READ_WRITE_TOKEN`) as
environment variables, then run `npm run db:migrate` against the production
database. Vercel auto-deploys on push.
