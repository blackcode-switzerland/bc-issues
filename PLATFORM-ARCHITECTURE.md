# It is a future plan (Dont mind this doc unless explicitly asked)

# Blackcode Platform Architecture
**Status:** decided, not yet implemented. This is the target architecture for
turning `bc-issues` from one app into a **suite of internal apps** (issues,
sales/CRM, bookkeeping, …) that humans and AI agents drive through one
consistent surface.

Read this before starting work on a second app, or before touching anything in
`lib/db/schema.ts`, `lib/api/`, `lib/auth/`, or `cli/`.

---

## 1. The decision, in one paragraph

We build a **monorepo of apps on a shared platform**: one Turborepo, one Neon
project with **one Postgres schema per app**, shared `packages/platform-*`
libraries, **one `bk` CLI** with a subcommand namespace per app, and **separate
Vercel projects + subdomains** per app. Apps stay visually and operationally
independent; underneath they share identity, workspaces, files, activity and
the agent surface.

We explicitly rejected full separation (separate repo/DB/CLI per app) because
it rebuilds ~65% of the codebase N times and makes cross-app agent work
impossible without distributed joins done by an LLM.

## 2. Why — the platform/app split already exists

Of the 26 tables in the current database, only about a third are an issue
tracker. The rest is a general-purpose internal-app platform:

| Layer | Tables |
|---|---|
| **Platform** (shared by every app) | `users`, `workspaces`, `workspace_members`, `workspace_counters`, `workspace_invitations`, `api_tokens`, `password_reset_otps`, `email_whitelist`, `uploads`, `comments`, `labels`, `events`, `inbox_messages`, `transaction_log`, `deletion_batches`, `error_events` |
| **Issues app** (moves to its own schema) | `issues`, `tasks`, `projects`, `project_updates`, `issue_labels`, `issue_assignees`, `issue_watchers`, `project_labels`, `project_members`, `attachments` |

Same story in code. Platform-shaped already: `lib/api/` (`apiHandler`, `Errors`,
`jsonList`, cursor pagination), `lib/auth/`, `lib/db/client.ts`,
`lib/cli-parity.test.ts`, `lib/limits.ts`, `lib/changelog.ts`,
`lib/agent-meta.ts`, `lib/agent-manifest.ts`,
`lib/blob-refs.ts`, `lib/upload.ts`, `lib/rich-text.ts`, the whole design system
and `components/ui/`, and most of `cli/internal/` (auth, config, output,
version floor). App-specific: `lib/work-items.ts`, `lib/db/queries/`, the
issue/task/project routes and pages.

Two things make the split cheaper than expected and should be preserved:
`comments` is **already polymorphic** (`parent_type` / `parent_id`), and
`labels` / `uploads` are **already workspace-scoped, not issue-scoped**.

## 3. Target repo layout

```
blackcode-platform/                 (monorepo, Turborepo)
├── apps/
│   ├── issues/                     ← today's bc-issues, moved wholesale
│   ├── sales/
│   └── books/
│   └── …                           each: app/ components/ lib/ docs/ public/
│                                          package.json next.config.js vercel.json
├── packages/
│   ├── platform-db/                Drizzle schema + client for the `platform` schema
│   ├── platform-auth/              next-auth config, bk_live_ token verification, RBAC
│   ├── platform-api/               apiHandler, Errors, jsonList, pagination, workspace-context
│   ├── platform-ui/                design system, rich-text-editor, confirm dialog, toasts
│   └── platform-agent/             agent manifest, llms.txt, changelog renderer,
│                                    /agent-updator, limits registry, CLI-parity harness
├── cli/                            ONE Go binary `bk`
│   └── internal/
│       ├── commands/platform/      login, meta, guide, changelog, workspace, search, link
│       ├── commands/issues/        issue, task, project
│       ├── commands/sales/         deal, contact
│       └── guide/topics/
│           ├── platform/           install-auth, workspaces, output, encoding, files
│           ├── issues/             items, move-copy, undo-and-trash, pitfalls
│           └── sales/
├── docs/                           PLATFORM docs only — see §7.5
│   └── changelog/                  one file per app + platform — see §7.3
├── devops/
├── package.json                    workspaces manifest only, no app deps
├── turbo.json
└── tsconfig.base.json
```

Each app keeps its own `app/api/**`, its own Drizzle schema file for its own
Postgres schema, its own guide topics, its own `docs/`, and its own Vercel
project. **No app publishes an OpenAPI spec** — see §6.

## 4. Database and storage

### 4.1 How the connections work

A Vercel storage "connection" is just **env vars injected into a project** —
`DATABASE_URL` from Neon, `BLOB_READ_WRITE_TOKEN` from Blob. Shared vs isolated
is purely a question of which values go where.

| Resource | Setup |
|---|---|
| Neon project | **one**, shared by every app |
| Neon role + connection string | **one per app** — `issues_app`, `sales_app`, … |
| Vercel Blob store | **one**, shared, with a per-app path prefix (`issues/…`) |

Every Vercel project points at the *same* database but logs in as a *different*
Postgres role. That role carries the grants in §4.3 — which is what makes the
app boundary a database guarantee rather than a convention. The Blob prefix
keeps files attributable and makes an extraction a prefix copy.

When adding an app in Vercel, connect the **existing** Neon project and Blob
store. Do not let the integration provision new ones.

### 4.2 Neon branches are the wrong axis — don't use them for this

A branch is a copy of the **whole database at a point in time**, for a different
*environment*. Giving each app a branch would give each app its own private copy
of the data that no other app can see — the exact opposite of the goal.

> **Branches = environment axis (prod / preview / migration rehearsal).
> Schemas = app axis.**

Keep using branches for preview deployments and for rehearsing migrations.

### 4.3 One Postgres schema per app

The split below is decided by one question — *"would a sales app need this?"*
The current table names mislead, because everything was built inside one app.
**16 of today's 26 tables are platform, not issue tracker.**

```
platform.*   users, workspaces, workspace_members, workspace_invitations,
             workspace_counters, app_access, api_tokens, password_reset_otps,
             email_whitelist, uploads, comments, labels, events, inbox_messages,
             transaction_log, deletion_batches, error_events, links, entities

issues.*     issues, tasks, projects, project_updates, issue_labels,
             issue_assignees, issue_watchers, project_labels, project_members,
             attachments

sales.*      deals, contacts, …
books.*      invoices, ledger_entries, …
```

A sales app needs workspaces, members, comments on a deal, files on a deal,
labels, an activity feed and an inbox. Those are org concepts, not issue-tracker
concepts. Only the ten tables that literally name an issue/task/project are
app-specific.

This is also a real namespace, not a naming convention: Neon's table browser has
a schema dropdown, so `platform` / `issues` / `sales` are visually separate the
moment you open it, and in code it reads `issues.issues` vs `sales.deals`.

**The boundary rule (non-negotiable):**

- An app **may** FK into and query `platform.*` freely.
- An app **may not** read or write another app's schema. Cross-app reads go
  through that app's HTTP API, or through `platform.links` / `platform.events`.

Enforce it with **per-app Postgres roles and grants**, not code review. The
`sales` role has no `SELECT` on `issues.*`. That makes the boundary a database
guarantee and keeps `pg_dump --schema=sales` a working extraction path from day
one — which is our answer to "what if we sell one of these later".

### 4.4 One workspace record, shared by every app

**A workspace is the company. An app is a capability inside it.** There is one
`kali-sa` row, and issues, sales and books all operate inside it.

Per-app workspaces were rejected: the URN `bc:sales:kali-sa/deal/17` only links
meaningfully to `bc:issues:kali-sa/issue/482` if `kali-sa` is the same
organisation in both, `bk activity --ws kali-sa` needs one tenant boundary, and
a person should have one workspace list — not the same company existing three
times under three slugs that drift apart.

### 4.5 Identity is global, access is per app

Three levels. Only the second and third are new.

| Table | Means | Scope |
|---|---|---|
| `platform.users` | your account | global — one login, every app |
| `platform.workspace_members` | you are in this organisation | per workspace |
| `platform.workspace_apps` | this app is turned on for this organisation | per workspace, per app |
| `platform.app_access` | you may use this app here | per workspace, per app, per user |

```
workspace_apps (workspace_id, app, enabled_at, enabled_by, default_access)
app_access     (workspace_id, app, user_id, role, granted_at, granted_by)
```

**Grant policy: default-on, per-workspace override.** Enabling an app for a
workspace grants every current member; new members joining the workspace are
granted automatically. An admin can flip `default_access` to `invite_only` per
workspace per app, and then access is granted one person at a time. This suits a
small internal team without giving up the strict path for something like
bookkeeping.

`workspace_invitations` gains an `app` column so a person can be invited
straight into one app.

**Visibility follows access, and this is what keeps it unconfusing:** the
workspace *record* is shared, the workspace *visibility* is not. Log into sales
and you see only workspaces where sales is enabled **and** you have access — not
every workspace you belong to. Same rule in the CLI: `bk workspace list` shows
the current app's workspaces; `bk workspace list --all` shows every workspace
with a badge per app.

Consequence worth having: **`bk meta` returns only the apps that token can
reach.** An agent working for a sales-only user cannot discover that the issues
app exists.

### 4.6 Three reshapes shared tables need before a second app

These are small migrations today and painful ones later. All three exist because
today's tables were written when there was exactly one app.

**`workspace_counters` — columns become rows.** Today it is one row per
workspace with `last_issue_seq`, `last_project_seq`, `last_task_seq`. Sales
would have to add `last_deal_seq` — an app editing a *platform* table, which is
the coupling we are removing.

```
platform.workspace_counters (workspace_id, app, entity_type, last_seq)
  PRIMARY KEY (workspace_id, app, entity_type)
```

Each app then allocates its own #numbers independently; issue #482 and deal #17
coexist.

**`comments.parent_type` becomes app-qualified.** `'issue'` → `'issues:issue'`,
so sales can store `'sales:deal'` without collision.

**`labels` gains a nullable `app` column.** `NULL` = shared across every app in
the workspace (one `urgent`, one `acme-corp` for the whole company); set = scoped
to that app. Default new labels to shared; the column exists so one app's
taxonomy can't clutter another's picker.

### 4.7 Migrations

### 4.5 Migrations

Platform-schema changes must be **expand → migrate → contract**. Apps deploy
independently, so a breaking `platform.*` change in a single deploy will break
every other app for the duration of the window. Never drop or rename a platform
column in the same release that stops using it. App-schema migrations are
unconstrained — nobody else can see them.

Rehearse every platform migration on a Neon branch first (§4.2).

## 5. Cross-app linking — the part that makes agents work

This is the piece that does not exist today and is the whole reason for the
shared database. Three additions to `platform`:

**URNs.** Every entity in every app is addressable by one string:

```
bc:issues:kali-sa/issue/482
bc:sales:kali-sa/deal/17
bc:books:kali-sa/invoice/2041
```

Format: `bc:<app>:<workspace-slug>/<entity-type>/<workspace-number>`. Note it
uses the **workspace #number**, consistent with the existing rule that the
global db id is never exposed.

**`platform.links`** — universal typed relations between any two URNs
(`blocks`, `relates_to`, `billed_as`, `caused_by`). Referential integrity for
cross-app relationships instead of a URL pasted in a description.

**`platform.events`** — generalize the existing per-workspace `events` table
into a cross-app append-only activity stream. Every app writes to it.

What this buys, and what is impossible without it:

```bash
bk activity --ws kali-sa --since 24h     # one merged timeline across all apps
bk search acme                           # federated search across all apps
bk link create bc:sales:…/deal/17 bc:issues:…/issue/482 --rel blocks
```

An agent can answer "what's happening in sales that affects this issue?" without
knowing anything about the sales schema.

## 6. CLI and the agent surface

**One interface, three entry points.** This is the simplification landed on
2026-08-03 and it is the model every future app inherits — it is not re-decided
per app.

| Entry point | Answers | Source of truth |
|---|---|---|
| **`bk guide`** | *How does this tool behave?* — flags, exit codes, workflows | embedded in the binary (`cli/internal/guide/topics/`) |
| **`bk meta`** | *What is the data right now?* — enums, limits, workspaces, health | live from each app's `GET /api/meta` |
| **`bk changelog`** | *What changed, and how do I adapt?* | `docs/changelog/*.md` |

Plus `bk skill sync` as the recovery loop: an agent that hits a wall re-syncs
its skill, re-reads the guide, and retries.

The rule that keeps these coherent scales unchanged to N apps: **a guide topic
never restates a value that `bk meta` carries.** Static behaviour in the binary,
dynamic data on the server. Guide topics that break this fail the build.

**Command shape — one binary, one login, one token, one version floor:**

```
bk login / meta / guide / changelog / workspace / search / activity / link / storage
bk issues  issue … | task … | project …
bk sales   deal … | contact …
bk books   invoice … | ledger …
```

Platform verbs sit at the root; **every app verb sits behind its app name.**
See §7.1 for why, and for how today's `bk issue …` keeps working.

`api_tokens` gains a `scopes` column so one `bk_live_` token can be scoped per
app. All the agent-onboarding work already built — the embedded `bk guide`, `bk
skill` and its self-update loop, `bk meta` + the limits registry, the CLI-parity
test, `/agent-updator`, `bk changelog`, `llms.txt`, the `X-BK-*` breadcrumb
headers, the CLI version floor — is written **once** and amortizes across every
app.

**The agent surface contract in `CLAUDE.md` extends unchanged to every app**, and
it is now three edits, not five: **route → `bk` command (+ guide topic if
behaviour changed) → changelog entry.** The CLI-parity test runs per app; so does
the guide test that forbids hardcoding a dynamic value.

This matters more at N apps than at one. The seven-surface contract we retired on
2026-08-03 had already drifted with a single app — the manifest claimed uploads
accept any file type (SVG is rejected), the pinned platform reference described a
response field that never existed and named a stale CLI version. Multiplying
hand-maintained copies by the number of apps would have made drift certain rather
than likely. One binary that ships its own guide, plus one `/api/meta` per app
for live values, is the only version of this that survives N apps.

**Consider also:** an MCP server exposing all apps' toolsets under one auth.
Given our consumers are largely Claude/Cursor-style clients, this may be higher
leverage than the CLI for them. `bk` stays for shell and CI. Only affordable
under this shared architecture — under full separation it would be N servers.

## 7. Separation between apps (the rule that keeps this legible)

Shared plumbing is only affordable if the seams stay obvious. A developer or an
agent landing anywhere in this repo must be able to tell **which app they are
in** without tracing imports. Sharing is opt-in via `packages/platform-*`;
everything else is app-local and visibly so.

### 7.1 CLI — app name is always the first segment

`bk <app> <noun> <verb>` for app commands; bare verbs are platform-only. This
is redundant-looking on purpose: `bk sales deal create` tells you the app, and
`bk deal create` does not. It also removes noun collisions before they happen
(every app will eventually want `report`, `note`, `status`).

- `bk --help` lists platform verbs, then one line per app.
- `bk issues --help` lists only that app's nouns.
- `bk guide`, `bk meta`, `bk changelog` all take `--app <name>` to scope, and
  all group their output by app when unscoped.
- Today's `bk issue …` becomes a **deprecated alias** for `bk issues issue …`
  via `cli/internal/commands/deprecations.go`. Kept two minor releases, then
  pruned. Nobody's script breaks silently.

Code follows the same shape: `cli/internal/commands/<app>/`, one Go package per
app, and no cross-imports between them.

### 7.2 Guide — one folder per app

`cli/internal/guide/topics/platform/` holds what is true everywhere (auth,
workspaces, output + exit codes, encoding, files, staying current).
`topics/<app>/` holds app behaviour. `bk guide` prints platform first, then each
app under its own heading; `bk guide --app sales` prints one.

A topic under `topics/<app>/` may not describe another app. The existing guide
test grows a check for it.

### 7.3 Changelog — one file per app, one merged feed

Split the file, keep the feed:

```
docs/changelog/platform.md      auth, workspaces, uploads, links, CLI itself
docs/changelog/issues.md
docs/changelog/sales.md
```

`bk changelog` merges them by date into one stream, each entry tagged with its
app. `bk changelog --app issues` filters. Rationale: a single file becomes a
merge-conflict magnet across app teams and does not survive an app extraction,
whereas per-app files give clear separation *and* a single agent-facing feed —
which is what you asked for. The existing rule is otherwise unchanged: a dated
`## YYYY-MM-DD — <title>` entry at the top of the right file, same commit.

A change touching `platform.*` goes in `platform.md`, **not** in the app that
happened to prompt it.

### 7.4 `bk meta` — grouped, never flattened

One call, separated payload:

```jsonc
{
  "user": …, "workspaces": […], "cli": …,      // platform
  "apps": {
    "issues": { "statuses": […], "priorities": […], "limits": … },
    "sales":  { "stages": […], "limits": … }
  }
}
```

Never merge two apps' vocabularies into one top-level list. An agent must not be
able to accidentally send a sales stage to the issues app.

### 7.5 Docs — platform at root, app docs in the app

| Location | Contents |
|---|---|
| `/docs` | the monorepo itself: this file, `platform-db.md`, `platform-api.md`, `cli.md`, `devops.md`, `env.md`, `cross-app-links.md`, `changelog/` |
| `/apps/<app>/docs` | that app only: its domain model, its routes, its UI patterns, its schema |

Rule: **root docs never describe an app's internals; app docs never describe
another app.** Today's `docs/backend.md` and `docs/frontend.md` split along that
line — the platform half moves to `/docs`, the issue-tracker half moves to
`apps/issues/docs/`.

### 7.6 The guardrails that enforce it

Extend the existing Go/TS tests rather than adding new conventions:

- CLI-parity test runs **per app** — every route has a command, in that app's
  namespace.
- Guide test grows: a topic under `topics/<app>/` may not name another app.
- New lint: an app package may not import from `apps/<other>/`. Only
  `packages/platform-*` is importable across apps.
- Database: per-app Postgres roles (§4) make the data boundary a hard one.

## 8. Deployment

- One Vercel project per app, one subdomain each
  (`issues.blackcode.ch`, `sales.blackcode.ch`, …).
- **One login across all of them.** The next-auth session cookie is scoped to
  `.blackcode.ch`, so signing in to issues signs you in to sales too. Access is
  still gated per app by §4.5 — shared session, separate authorisation. Without
  this, moving between apps means logging in N times, which is the fastest way
  to make a suite feel like N products.
- Filtered builds via `turbo-ignore` so a sales commit doesn't rebuild issues.
- Independent deploys, independent blast radius, independent env vars.
- Vercel Blob and the upload pipeline are shared through `platform.uploads`;
  reference-counting (`lib/blob-refs.ts`) must become app-aware — a file is
  deletable only when **no app** references it.

A monorepo does not imply a shared deployment. Operationally these stay
separate products.

## 9. Known costs — accept these knowingly

- **Expand/migrate/contract discipline** on every platform-schema change. This
  is the main ongoing tax.
- **Shared Neon connection budget.** One pooled connection string per app;
  watch the ceiling as apps are added.
- **A `platform-ui` change touches every app at once.** Fine internally; would
  need package versioning if we ever sell.
- **Cross-app reference counting** for blob GC is more complex than today's
  single-app scan.

## 10. Sequencing — do not rewrite, extract in place

Order matters. Steps 3–5 must happen **while issues is still the only app** —
each is a rename today and a migration with N callers later.

1. **Move `bc-issues` into `apps/issues`** inside a Turborepo. Zero behavior
   change. Done when `npx tsc --noEmit`, `npm test` (parity), and
   `cd cli && go build ./...` all still pass.
2. **Carve out `packages/platform-*`** from `lib/` and `components/` along the
   split in §2. Still zero behavior change.
3. **Apply the §7 separation to the one app that exists.** Namespace the CLI
   (`bk issues …` + deprecated aliases), split guide topics into
   `platform/` + `issues/`, split the changelog into `docs/changelog/`, group
   `bk meta` under `apps.issues`, split the docs. Cheap now with one app;
   expensive and conflict-prone with three.
4. **Move the issue-tracker tables into an `issues` Postgres schema**, leaving
   platform tables behind. Add the per-app roles and grants.
5. **Build URNs, `platform.links`, `platform.events`, and federated
   `bk activity` / `bk search`** against the single existing app, so the
   cross-app machinery is real working code rather than a theory.
6. **Build `apps/sales` on the platform packages.** This is the test of whether
   the abstraction actually holds. Expect to fix leaks found here.

Steps 1–4 are refactors with a green-test definition of done. Step 5 is the only
genuinely new product surface. Step 6 is the first real app.

## 11. On selling these later

Monorepo + shared database does **not** block it. The hard prerequisite for
selling is multi-tenancy, and that is already solved — `workspace_id` is on
everything.

- **Sell the suite as one product:** the monorepo is strictly better.
- **Extract one app:** per-schema isolation plus its own Vercel project makes
  this "split the repo, `pg_dump --schema=sales`, vendor the `platform-*`
  packages" — weeks, not a rewrite.

Full separation would not make that extraction meaningfully cheaper. It would
just charge a certain, daily, N× duplication tax to hedge an uncertain,
one-time event.
