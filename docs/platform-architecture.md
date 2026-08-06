# Blackcode Platform Architecture

**Status: this is how the platform works today.** Every rule below is live in
production. It describes the shape of the monorepo, the database boundary, the
access model, the URN scheme and the separation rules between apps.

Read this before starting work on a second app, or before touching anything in
`packages/platform-*`, an app's `lib/db/schema.ts`, `lib/api/`, or `cli/`.

- **How** to add an app: [`adding-an-app.md`](adding-an-app.md) — the walked checklist.
- **Why** the repo looks like this: [`2026-08-platform-migration.md`](2026-08-platform-migration.md) — the history.
- **How to remove** an app: [`extracting-an-app.md`](extracting-an-app.md) — rehearsed.
- **The database boundary** in operational detail: [`platform-db.md`](platform-db.md).

> This document was `PLATFORM-ARCHITECTURE.md` at the repo root until 2026-08-06,
> where it opened "decided, not yet implemented". It is all implemented. The
> sequencing and phase-ordering sections it used to carry are history and now
> live in `2026-08-platform-migration.md`; every design rule was kept.

---

## 1. The decision, in one paragraph

Blackcode runs a **monorepo of apps on a shared platform**: one Turborepo, one
Neon project with **one Postgres schema per app**, shared `packages/platform-*`
libraries, **one `bk` CLI** with a subcommand namespace per app, and **separate
Vercel projects + subdomains** per app. Apps stay visually and operationally
independent; underneath they share identity, workspaces, files, activity and the
agent surface.

Full separation — separate repo, database and CLI per app — was **rejected**. It
rebuilds ~65% of the codebase N times and makes cross-app agent work impossible
without distributed joins performed by an LLM. That decision is settled; see §10
for why it does not block selling an app later.

## 2. Why — the platform/app split was already there

Of the 26 tables the single app had, only about a third were an issue tracker.
The rest was a general-purpose internal-app platform, and the migration made that
split explicit.

| Layer | Tables |
|---|---|
| **Platform** (shared by every app) | `users`, `workspaces`, `workspace_members`, `workspace_invitations`, `apps`, `workspace_apps`, `app_access`, `api_tokens`, `password_reset_otps`, `email_whitelist`, `uploads`, `comments`, `labels`, `events`, `inbox_messages`, `deletion_batches`, `error_events`, `links`, `entities`, `blob_references` |
| **Issues app** (its own schema) | `issues`, `tasks`, `projects`, `project_updates`, `issue_labels`, `issue_assignees`, `issue_watchers`, `project_labels`, `project_members`, `attachments`, `workspace_counters` |

Two properties made the split cheaper than expected and are worth preserving:
`comments` is **polymorphic** (`parent_type` / `parent_id`), and `labels` /
`uploads` are **workspace-scoped, not issue-scoped**.

## 3. Repo layout

```
blackcode-platform/                 (monorepo, Turborepo)
├── apps/
│   ├── issues/                     the product
│   ├── _template/                  the scaffold — copy it, never edit in place
│   └── …                           each: app/ components/ lib/ docs/ public/
├── packages/
│   ├── platform-db/                Drizzle schema + client for the `platform` schema
│   ├── platform-auth/              next-auth config, bk_live_ tokens, per-app access
│   ├── platform-api/               apiHandler, Errors, jsonList, pagination, limits
│   ├── platform-ui/                design system, rich-text editor, confirm dialog
│   ├── platform-storage/           upload ledger, app-prefixed paths, the delete gate
│   ├── platform-agent/             merged changelog feed, CLI version floor
│   └── platform-testing/           the CLI-parity and app-isolation harnesses
├── cli/                            ONE Go binary `bk`
│   └── internal/
│       ├── commands/platform/      login, meta, guide, changelog, workspace, search, link
│       ├── commands/issues/        issue, task, project
│       ├── cmdutil/                what both need; app packages never import each other
│       └── guide/topics/{platform,issues,template}/
├── docs/                           PLATFORM docs only — see §7.5
│   ├── changelog/                  one file per app + platform.md — see §7.3
│   └── sql/                        role creation, the boundary probe, rollbacks
├── devops/
├── package.json                    workspaces manifest only, no app deps
├── turbo.json
└── tsconfig.base.json
```

**There are seven platform packages.** `platform-storage` and `platform-testing`
arrived during the migration and are as load-bearing as the rest — the first owns
the only code that can reach `del()`.

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
| Vercel Blob store | **one** production store, shared, with a per-app path prefix |

Every Vercel project points at the *same* database but logs in as a *different*
Postgres role. That role carries the grants in §4.3 — which is what makes the app
boundary a database guarantee rather than a convention.

When adding an app in Vercel, connect the **existing** Neon project and Blob
store. Do not let the integration provision new ones.

> **There is a second Blob store, and it is not redundant.**
> `blackcode-platform-preview-blob` is wired to preview deployments only.
> `sweepOrphanedUrls` runs on user action — purging from trash, hard-deleting a
> comment — so a preview deployment pointed at the production store would delete
> real production bytes. The separate preview store is what makes that
> impossible. Removing it reintroduces the path.

### 4.2 Neon branches are the wrong axis for apps

A branch is a copy of the **whole database at a point in time**, for a different
*environment*. Giving each app a branch would give each app a private copy of the
data no other app can see — the opposite of the goal.

> **Branches = environment axis (prod / preview / migration rehearsal).
> Schemas = app axis.**

Branches are used for preview deployments and for rehearsing migrations, and
rehearsing on one is expected before any platform-schema change.

### 4.3 One Postgres schema per app

The split is decided by one question — *"would a sales app need this?"*

```
platform.*   users, workspaces, workspace_members, workspace_invitations,
             apps, workspace_apps, app_access, api_tokens, password_reset_otps,
             email_whitelist, uploads, comments, labels, events, inbox_messages,
             deletion_batches, error_events, links, entities, blob_references

issues.*     issues, tasks, projects, project_updates, issue_labels,
             issue_assignees, issue_watchers, project_labels, project_members,
             attachments, workspace_counters
```

A sales app needs workspaces, members, comments on a deal, files on a deal,
labels, an activity feed and an inbox. Those are org concepts, not issue-tracker
concepts. Only the tables that literally name an issue/task/project are
app-specific.

This is a real namespace, not a naming convention: Neon's table browser has a
schema dropdown, so `platform` / `issues` are visually separate the moment you
open it, and in code it reads `issues.issues` vs `sales.deals`.

**The boundary rule (non-negotiable):**

- An app **may** FK into and query `platform.*` freely.
- An app **may not** read or write another app's schema. Cross-app reads go
  through that app's HTTP API, or through `platform.links` / `platform.events`.

This is enforced with **per-app Postgres roles and grants**, not code review. The
`sales` role has no `SELECT` on `issues.*`. Production runs as `issues_app`,
which owns **zero** objects and can perform no DDL and not touch the migration
ledger. Prove it with `docs/sql/app-boundary-probe.sql`, run **as the app role** —
the properties are invisible from any other session, which is why it is a manual
provisioning step and not a CI test.

> **`pg_dump --schema=<app>` is NOT an extraction path, and it fails silently.**
> The dump emits the app's triggers and every foreign key into `platform`; all of
> them fail at restore, and `psql` exits **0** regardless. The result boots,
> serves content, and has quietly lost referential integrity and all blob-index
> maintenance. An extraction dumps `platform` + the app's schema + `drizzle`.
> Procedure: [`extracting-an-app.md`](extracting-an-app.md).

### 4.4 One workspace record, shared by every app

**A workspace is the company. An app is a capability inside it.** There is one
`kali-sa` row, and every app operates inside it.

Per-app workspaces were rejected: the URN `bc:sales:kali-sa/deal/17` only links
meaningfully to `bc:issues:kali-sa/issue/482` if `kali-sa` is the same
organisation in both, `bk activity --ws kali-sa` needs one tenant boundary, and a
person should have one workspace list — not the same company existing three times
under three slugs that drift apart.

### 4.5 Identity is global, access is per app

| Table | Means | Scope |
|---|---|---|
| `platform.users` | your account | global — one login, every app |
| `platform.workspace_members` | you are in this organisation | per workspace |
| `platform.workspace_apps` | this app is on for this organisation | per workspace, per app |
| `platform.app_access` | you may use this app here | per workspace, per app, per user |

```
workspace_apps (workspace_id, app, enabled_at, enabled_by, default_access)
app_access     (workspace_id, app, user_id, role, granted_at, granted_by)
```

**Grant policy: default-on, per-workspace override.** Enabling an app for a
workspace grants every current member; new members are granted automatically. An
admin can flip `default_access` to `invite_only` per workspace per app, after
which access is granted one person at a time. `workspace_invitations` carries an
`app` column so a person can be invited straight into one app.

**Visibility follows access, and that is what keeps it unconfusing:** the
workspace *record* is shared, the workspace *visibility* is not. Log into sales
and you see only workspaces where sales is enabled **and** you have access — not
every workspace you belong to. Same rule in the CLI: `bk workspace list` shows
the current app's workspaces; `--all` shows every workspace with a badge per app.

Enforcement is `resolveWorkspace`, behind `PLATFORM_ENFORCE_APP_ACCESS`.

Consequence worth having: **`bk meta` returns only the apps that token can
reach.** An agent working for a sales-only user cannot discover the issues app
exists.

### 4.6 Counters live in the app, not in a shared table

`workspace_counters` is **`issues.workspace_counters`**. It used to be a platform
table, and the plan called for reshaping it to
`(workspace_id, app, entity_type, last_seq)` so every app could share one
counter. Building `apps/_template` showed that to be the wrong trade, and
migration **0040 moved the table into the app's schema** instead.

The argument: sharing a counter buys **nothing**. No query ever spans two apps'
counters, so a shared table adds only a shared write point and a shared migration
every time any app invents an entity type. An app's #number sequence is app data.
Each app keeps its own — `apps/_template` does it in three lines — and no app
ever ALTERs a platform table to add an entity.

Reshaping in place would also have left the harder half unsolved: it would still
have been a platform table that apps write to, which is the coupling §4.3 exists
to forbid.

> **The general rule this produced:** before reshaping a shared table so more apps
> can use it, ask whether they should be sharing it at all. "Make it generic" is
> the reflex; "move it to the app that owns it" is often the smaller change and
> always the cleaner boundary.

**Two reshapes are designed but NOT built.** Both are cheap now and painful
later, and the first real second app needs them:

| Owed | What | Why it matters |
|---|---|---|
| `comments.parent_type` app-qualification | `'issue'` → `'issues:issue'` | Values today are still `issue` and `task`. Without the prefix, `sales` storing `'deal'` risks a collision the moment two apps pick the same noun |
| `labels.app` nullable column | `NULL` = shared across every app in the workspace; set = scoped to that app | The column does not exist yet. Default new labels to shared; it exists so one app's taxonomy cannot clutter another's picker |

### 4.7 Migrations

Platform-schema changes must be **expand → migrate → contract**. Apps deploy
independently, so a breaking `platform.*` change in a single deploy breaks every
other app for the duration of the window. Never drop or rename a platform column
in the same release that stops using it.

App-schema migrations are unconstrained — nobody else can see them.

Rehearse every platform migration on a Neon branch first (§4.2), **including the
rollback**. Every phase of the migration did, and it caught a real bug in most of
them.

Migrations run as `MIGRATE_DATABASE_URL` (the schema owner), never as the app
role, which cannot migrate by design. Operational detail: [`devops.md`](devops.md).

## 5. Cross-app linking — the part that makes agents work

Three additions to `platform` carry it, and all three are live.

**URNs.** Every entity in every app is addressable by one string:

```
bc:issues:kali-sa/issue/482
bc:sales:kali-sa/deal/17
```

Format: `bc:<app>:<workspace-slug>/<entity-type>/<workspace-number>`. It uses the
**workspace #number**, consistent with the rule that the global db id is never
exposed.

Every issue, task and project is projected into **`platform.entities` in the same
transaction as its source write**. A projection that can drift is worse than no
projection. Read the header of `apps/issues/lib/db/queries/entities.ts` before
touching a write path; `bk super-admin entity-drift` is the reconciler.

**`platform.links`** — universal typed relations between any two URNs (`blocks`,
`relates_to`, `billed_as`, `caused_by`). Referential integrity for cross-app
relationships instead of a URL pasted in a description.

**`platform.events`** — a cross-app append-only activity stream, carrying a NOT
NULL `app` column. Every app writes to it.

What this buys:

```bash
bk activity --ws kali-sa --since 24h     # one merged timeline across all apps
bk search acme                           # federated search across all apps
bk link create bc:sales:…/deal/17 bc:issues:…/issue/482 --rel blocks
```

An agent can answer "what's happening in sales that affects this issue?" without
knowing anything about the sales schema.

### 5.1 Storage is shared, app-attributed, and reference-counted across apps

`platform.uploads.app` records who uploaded each file. New uploads land under
`<app>/<workspace>/<file>`.

> **Existing blobs were never moved, and must not be.** 104 of 105 files sit at
> the store root with no prefix. Moving them would mean rewriting every URL
> already embedded in descriptions and comments. **`pathname` is where a file is;
> `app` is who owns it.** Do not "tidy" the root files — that is a data-integrity
> operation, not housekeeping.

Blob deletion works across deployments via **`platform.blob_references`**, an
index each app maintains **from Postgres triggers on its own content tables** —
not from application code, so no write path can forget it. That concentrates the
entire remaining risk in one place:

> **Any new content column that can hold a file URL needs a
> `platform.blob_references` trigger, in the same migration.**

A file is deletable only when **no app** references it, and the gate **fails
closed**: an app registered in `platform.apps` that cannot yet answer for its
references stops blob deletion platform-wide — correctly, because nobody can
prove the file is unused. Read `packages/platform-storage/src/references.ts` and
`packages/platform-db/src/schema.ts` at `blobReferences` before touching anything
near this. Those two files are what stand between a code change and unrecoverable
data loss. `bk super-admin blob-drift` is the reconciler; read `missing_count`
first.

## 6. CLI and the agent surface

**One interface, three entry points.** This is the model every future app
inherits — it is not re-decided per app.

| Entry point | Answers | Source of truth |
|---|---|---|
| **`bk guide`** | *How does this tool behave?* — flags, exit codes, workflows | embedded in the binary (`cli/internal/guide/topics/`) |
| **`bk meta`** | *What is the data right now?* — enums, limits, workspaces, health | live from each app's `GET /api/meta` |
| **`bk changelog`** | *What changed, and how do I adapt?* | `docs/changelog/*.md` |

Plus `bk skill sync` as the recovery loop: an agent that hits a wall re-syncs its
skill, re-reads the guide, and retries.

The rule that keeps these coherent scales unchanged to N apps: **a guide topic
never restates a value that `bk meta` carries.** Static behaviour in the binary,
dynamic data on the server. Guide topics that break this fail the build.

**The HTTP API is private plumbing with no public contract.** No OpenAPI spec, no
fat page manifest — both were deleted on 2026-08-03 because they were
hand-maintained copies of facts that lived elsewhere, and had already drifted with
a single app. The `/api/openapi.json` and `/api/docs` routes remain as **410 Gone**
stubs carrying a `suggestion`, deliberately and indefinitely: a 410 an agent can
act on inside the same run beats a 404 that looks like a bug.

**Command shape — one binary, one login, one token, one version floor:**

```
bk login / meta / guide / changelog / workspace / search / activity / link / storage
bk issues  issue … | task … | project …
bk sales   deal … | contact …
```

Platform verbs sit at the root; **every app verb sits behind its app name.** See
§7.1.

`api_tokens` carries a `scopes` column so one `bk_live_` token can be scoped per
app. All the agent-onboarding machinery — the embedded guide, `bk skill` and its
self-update loop, `bk meta` and the limits registry, the CLI-parity test,
`bk changelog`, the version floor — is written **once** and amortises across
every app.

**Consider also:** an MCP server exposing all apps' toolsets under one auth. Given
our consumers are largely Claude/Cursor-style clients, this may be higher leverage
than the CLI for them. `bk` stays for shell and CI. Only affordable under this
shared architecture — under full separation it would be N servers.

## 7. Separation between apps (the rule that keeps this legible)

Shared plumbing is only affordable if the seams stay obvious. A developer or an
agent landing anywhere in this repo must be able to tell **which app they are in**
without tracing imports. Sharing is opt-in via `packages/platform-*`; everything
else is app-local and visibly so.

### 7.1 CLI — app name is always the first segment

`bk <app> <noun> <verb>` for app commands; bare verbs are platform-only. This is
redundant-looking on purpose: `bk sales deal create` tells you the app, and
`bk deal create` does not. It also removes noun collisions before they happen
(every app will eventually want `report`, `note`, `status`).

- `bk --help` lists platform verbs, then one line per app.
- `bk issues --help` lists only that app's nouns.
- `bk guide`, `bk meta`, `bk changelog` all take `--app <name>` to scope.

Code follows the same shape: `cli/internal/commands/<app>/`, one Go package per
app, and **no cross-imports between them** (`boundaries_test.go`). Anything two
need goes in `cmdutil`.

The pre-1.10.0 un-namespaced spellings (`bk issue …`) were **removed in 1.12.0**.
They now exit non-zero and name their replacement, via
`cli/internal/commands/deprecations.go`. That table is the recovery path for a
stale script, and its entries outlive the thing they replace by one release on
purpose.

### 7.2 Guide — one folder per app

`topics/platform/` holds what is true everywhere (auth, workspaces, output + exit
codes, encoding, files, staying current). `topics/<app>/` holds app behaviour.
`bk guide` prints platform first, then each app under its own heading.

A topic under `topics/<app>/` may not describe another app — `guide_test.go`
enforces it, along with the no-hardcoded-dynamic-values rule.

### 7.3 Changelog — one file per app, one merged feed

```
docs/changelog/platform.md      auth, workspaces, uploads, links, CLI itself
docs/changelog/issues.md
docs/changelog/sales.md
```

Files are discovered by reading the directory, so adding an app is adding a file.
`bk changelog` merges them by date into one stream, each entry tagged with its
app; `--app issues` filters. A single file would be a merge-conflict magnet
across app teams and would not survive an app extraction.

A change touching `platform.*` goes in `platform.md`, **not** in the app that
happened to prompt it.

### 7.4 `bk meta` — grouped, never flattened

```jsonc
{
  "user": …, "workspaces": […], "cli": …,      // platform
  "apps": {
    "issues": { "vocabulary": …, "limits": …, "media": … },
    "sales":  { "vocabulary": …, "limits": … }
  }
}
```

Never merge two apps' vocabularies into one top-level list. An agent must not be
able to accidentally send a sales stage to the issues app.

> The top-level `vocabulary` / `limits` / `media` keys still exist and are
> **deprecated**. They are served for binaries older than the namespacing, and go
> away once `CLI_MIN_VERSION` passes the release that stopped needing them. Read
> `apps.<slug>`.

### 7.5 Docs — platform at root, app docs in the app

| Location | Contents |
|---|---|
| `/docs` | the monorepo itself: this file, `platform-db.md`, `backend.md`, `frontend.md`, `cli.md`, `devops.md`, `env.md`, `adding-an-app.md`, `extracting-an-app.md`, `changelog/`, `sql/` |
| `/apps/<app>/docs` | that app only: its domain model, its routes, its UI patterns, its schema |

Rule: **root docs never describe an app's internals; app docs never describe
another app.**

### 7.6 The guardrails that enforce it

- **`lib/cli-parity.test.ts`, per app** — every route reachable from `bk`, every
  claimed route real. `bk __routes` tags each route with its app, and exactly one
  app sets `hostsPlatformRoutes` (today `issues`, because the shared routes
  physically live in its tree). Without that flag every platform route would go
  unchecked by everybody.
- **`lib/app-isolation.test.ts`, per app** — no import resolving into another
  app, no query naming another app's schema. **Resolution-based, not
  glob-based.** An ESLint rule tried to cover the first half and never matched
  the shape that actually escapes an app; it was deleted on 2026-08-06. Do not
  re-add it — a glob over import strings cannot express "resolves into a sibling
  app".
- **Go:** `routes_test.go` (every leaf command declares its routes),
  `guide_test.go` (no hardcoded dynamic values, no cross-app references),
  `skill_test.go`, `groups_test.go`, `boundaries_test.go`.
- **Database:** per-app Postgres roles make the data boundary a hard one.

## 8. Deployment

- One Vercel project per app, one subdomain each
  (`issues.blackcode.ch`, `sales.blackcode.ch`, …).
- Filtered builds via `turbo-ignore` so a sales commit doesn't rebuild issues.
- Independent deploys, independent blast radius, independent env vars.
- Vercel Blob and the upload pipeline are shared through `platform.uploads`, with
  cross-app reference counting (§5.1).

> **One login across all apps is DESIGNED BUT NOT LIVE.** The intent is a
> next-auth session cookie scoped to `.blackcode.ch`, so signing in to issues
> signs you in to sales too — access still gated per app by §4.5, i.e. shared
> session, separate authorisation. Without it, moving between apps means logging
> in N times, which is the fastest way to make a suite feel like N products.
>
> Deferred since Phase 4 because it **signs everyone out once**, and there is a
> second cost that is easy to miss: production sets `__Host-`-prefixed cookies,
> and the `__Host-` prefix **cannot carry a `Domain` attribute**. Moving to
> `.blackcode.ch` therefore means *renaming* the cookie, not just widening it.
> Schedule it at a quiet hour with a changelog notice, before a second app needs
> shared sign-in.

A monorepo does not imply a shared deployment. Operationally these stay separate
products.

## 9. Known costs — accepted knowingly

- **Expand/migrate/contract discipline** on every platform-schema change. This is
  the main ongoing tax.
- **Shared Neon connection budget.** One pooled connection string per app; watch
  the ceiling as apps are added.
- **A `platform-ui` change touches every app at once.** Fine internally; would
  need package versioning if we ever sell.
- **Cross-app reference counting** for blob GC is more complex than a single-app
  scan, and it **fails closed** — a misconfigured app can stop deletion
  platform-wide. That is the correct direction to fail, but it has to be
  understood before you register an app.

## 10. On selling one of these later

> **Rehearsed 2026-08-05.** It works, and takes ~20 minutes — but the obvious
> command is the wrong one and fails silently. See the callout in §4.3.

Monorepo + shared database does **not** block it. The hard prerequisite for
selling is multi-tenancy, and that is already solved — `workspace_id` is on
everything.

- **Sell the suite as one product:** the monorepo is strictly better.
- **Extract one app:** per-schema isolation plus its own Vercel project makes
  this "split the repo, dump `platform` + the app's schema + `drizzle`, vendor
  the `platform-*` packages" — weeks, not a rewrite.

**An extraction owes more than the database**, and this repo deliberately does
not answer the last of these: blob storage (pre-prefix files sit unprefixed at
the store root), vendoring `packages/platform-*`, and `platform.users` containing
every user of every app. The data-protection question there belongs to whoever
does it.

Full separation would not make that extraction meaningfully cheaper. It would
just charge a certain, daily, N× duplication tax to hedge an uncertain, one-time
event.
