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
`lib/openapi/` + `parity.test.ts`, `lib/changelog.ts`, `lib/agent-manifest.ts`,
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
├── packages/
│   ├── platform-db/                Drizzle schema + client for the `platform` schema
│   ├── platform-auth/              next-auth config, bk_live_ token verification, RBAC
│   ├── platform-api/               apiHandler, Errors, jsonList, pagination, workspace-context
│   ├── platform-ui/                design system, rich-text-editor, confirm dialog, toasts
│   ├── platform-agent/             agent-manifest, llms.txt, changelog renderer, /agent-updator
│   └── openapi-kit/                spec builder + the parity test harness
└── cli/                            ONE Go binary `bk`, one subcommand namespace per app
```

Each app keeps its own `app/api/**`, its own Drizzle schema file for its own
Postgres schema, its own OpenAPI spec fragment, and its own Vercel project.

## 4. Database

**One Neon project. One Postgres schema per app.**

```
platform.*     users, workspaces, workspace_members, api_tokens, uploads,
               comments, labels, events, inbox_messages, links, entities, …
issues.*       issues, tasks, projects, …
sales.*        deals, contacts, …
books.*        invoices, ledger_entries, …
```

**The boundary rule (non-negotiable):**

- An app **may** FK into and query `platform.*` freely.
- An app **may not** read or write another app's schema. Cross-app reads go
  through that app's HTTP API, or through `platform.links` / `platform.events`.

Enforce it with **per-app Postgres roles and grants**, not code review. The
`sales` role has no `SELECT` on `issues.*`. That makes the boundary a database
guarantee and keeps `pg_dump --schema=sales` a working extraction path from day
one — which is our answer to "what if we sell one of these later".

**Migrations.** Platform-schema changes must be **expand → migrate → contract**.
Apps deploy independently, so a breaking `platform.*` change in a single deploy
will break every other app for the duration of the window. Never drop or rename
a platform column in the same release that stops using it. App-schema
migrations are unconstrained — nobody else can see them.

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

**One binary, one login, one token, one changelog, one version floor.**

```
bk issue …    bk task …    bk project …      (issues app)
bk deal …     bk contact …                   (sales app)
bk invoice …                                 (books app)

bk meta / search / activity / link / workspace / login / storage / changelog
```

`api_tokens` gains a `scopes` column so one `bk_live_` token can be scoped per
app. All the agent-onboarding work already built — `agent-manifest.ts`, the
OpenAPI spec + parity test, `/agent-updator`, `/changelog`, `llms.txt`, the
`X-BK-*` breadcrumb headers, the CLI version floor — is written **once** and
amortizes across every app.

**The multi-surface sync contract in `CLAUDE.md` extends unchanged to every
app.** Route → OpenAPI spec → CLI → docs → changelog, in the same change. The
parity test runs per app.

**Consider also:** an MCP server exposing all apps' toolsets under one auth.
Given our consumers are largely Claude/Cursor-style clients, this may be higher
leverage than the CLI for them. `bk` stays for shell and CI. Only affordable
under this shared architecture — under full separation it would be N servers.

## 7. Deployment

- One Vercel project per app, one subdomain each
  (`issues.blackcode.ch`, `sales.blackcode.ch`, …).
- Filtered builds via `turbo-ignore` so a sales commit doesn't rebuild issues.
- Independent deploys, independent blast radius, independent env vars.
- Vercel Blob and the upload pipeline are shared through `platform.uploads`;
  reference-counting (`lib/blob-refs.ts`) must become app-aware — a file is
  deletable only when **no app** references it.

A monorepo does not imply a shared deployment. Operationally these stay
separate products.

## 8. Known costs — accept these knowingly

- **Expand/migrate/contract discipline** on every platform-schema change. This
  is the main ongoing tax.
- **Shared Neon connection budget.** One pooled connection string per app;
  watch the ceiling as apps are added.
- **A `platform-ui` change touches every app at once.** Fine internally; would
  need package versioning if we ever sell.
- **Cross-app reference counting** for blob GC is more complex than today's
  single-app scan.

## 9. Sequencing — do not rewrite, extract in place

Order matters. Steps 3 and 4 must happen **while issues is still the only app**.

1. **Move `bc-issues` into `apps/issues`** inside a Turborepo. Zero behavior
   change. Done when `npx tsc --noEmit`, `npm test` (parity), and
   `cd cli && go build ./...` all still pass.
2. **Carve out `packages/platform-*`** from `lib/` and `components/` along the
   split in §2. Still zero behavior change.
3. **Move the issue-tracker tables into an `issues` Postgres schema**, leaving
   platform tables behind. Add the per-app roles and grants. *This is a rename
   today and a migration nightmare once a second app exists — do it early.*
4. **Build URNs, `platform.links`, `platform.events`, and federated
   `bk activity` / `bk search`** against the single existing app, so the
   cross-app machinery is real working code rather than a theory.
5. **Build `apps/sales` on the platform packages.** This is the test of whether
   the abstraction actually holds. Expect to fix leaks found here.

Steps 1–3 are refactors with a green-test definition of done. Step 4 is the
only genuinely new product surface. Step 5 is the first real app.

## 10. On selling these later

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
