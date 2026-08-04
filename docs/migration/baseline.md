# Platform migration — pre-migration baseline

**Captured:** 2026-08-04
**Commit:** `47320b0c44ee48e0da0a73008c3365ec2fc95d39`
**Tag:** `pre-platform-migration`
**Purpose:** the known-good state every phase of `PLATFORM-MIGRATION-PLAN.md` is
measured against. If a refactor changes a number in this file, that change must
be deliberate and explained in the phase report.

Companion docs: `PLATFORM-ARCHITECTURE.md` (target design),
`PLATFORM-MIGRATION-PLAN.md` (ordered migration).

---

## 1. Toolchain

| | |
|---|---|
| Node | v20.20.0 |
| npm | 10.8.2 |
| Go | go1.26.3 darwin/arm64 |
| Postgres (Neon) | 17 |
| Next.js | 16 (App Router) |

---

## 2. The four verify commands

All four run from the repo root and were green at this commit.

### `npx tsc --noEmit`

```
(no output — exit 0)
```

### `npm test`

```
> blackcode-issues@1.0.0 test
> vitest run

 RUN  v4.1.8 /Users/blackcode/Documents/bc-issues

 Test Files  5 passed | 1 skipped (6)
      Tests  65 passed | 6 skipped (71)
   Duration  419ms
```

**Baseline numbers:** 6 test files (5 passed, 1 skipped), 71 tests
(65 passed, 6 skipped).

### `cd cli && go build ./... && go vet ./... && go test ./...`

```
=== BUILD ===  OK
=== VET ===    OK
=== TEST ===
?   github.com/blackcode-switzerland/bc-issues/cli/cmd/bk               [no test files]
?   github.com/blackcode-switzerland/bc-issues/cli/internal/browser     [no test files]
ok  github.com/blackcode-switzerland/bc-issues/cli/internal/client
ok  github.com/blackcode-switzerland/bc-issues/cli/internal/commands
?   github.com/blackcode-switzerland/bc-issues/cli/internal/config      [no test files]
ok  github.com/blackcode-switzerland/bc-issues/cli/internal/guide
?   github.com/blackcode-switzerland/bc-issues/cli/internal/output      [no test files]
ok  github.com/blackcode-switzerland/bc-issues/cli/internal/skill
?   github.com/blackcode-switzerland/bc-issues/cli/internal/version     [no test files]
```

**Baseline:** 4 packages with tests, all passing. Go module path is
`github.com/blackcode-switzerland/bc-issues/cli` — note it embeds the **old repo
name** and does not change when the GitHub repo is renamed (GitHub redirects).

### `npm run build`

```
✓ Compiled successfully in 3.2s
✓ Generating static pages using 9 workers (42/42) in 124.1ms
  (full route table emitted — 42 pages + ~77 API routes)

> blackcode-issues@1.0.0 postbuild
> drizzle-kit migrate
```

`npx next build` alone: **exit 0**, reproducibly.

> ### ⚠ `npm run build` is not a pure build — it writes to a database
>
> `package.json` has `"postbuild": "drizzle-kit migrate"`. So the command the plan
> lists as a verification gate **applies Drizzle migrations to whatever
> `DATABASE_URL` resolves to**. Two consequences, both bit us during this capture:
>
> **1. It fails when the local database is down, for reasons unrelated to the
> code.** The local DB is Postgres on `localhost:5434` from `docker-compose.yml`.
> During this capture Docker stopped, port 5434 closed, and `npm run build`
> returned **exit 1** — while `npx next build` returned 0 and the app compiled
> perfectly. A red `npm run build` therefore does **not** imply a broken build.
>
> Before treating `npm run build` as a gate in any phase:
> ```bash
> nc -z localhost 5434 || docker compose up -d      # DB must be reachable
> ```
> When diagnosing a failure, re-run `npx next build` to separate a compile
> failure from a migration failure.
>
> **2. Never run it with a production `DATABASE_URL` in the environment.** It
> would silently migrate production as a side effect of a build. Phase 3 makes
> this sharper still: after the schema split, an accidental run against the wrong
> role or `search_path` is a data hazard, not just a nuisance.
>
> Out of scope to fix here, but worth considering later: moving `postbuild` to an
> explicit `db:migrate` script so "build" means build.

---

## 3. Agent surface

### CLI version

| | |
|---|---|
| npm package | `@blackcode_sa/bc-issues` |
| latest published | **1.9.3** (`npm dist-tags` → `latest: 1.9.3`) |
| published versions | …, 1.9.0, 1.9.1, 1.9.2, 1.9.3 |
| `CLI_LATEST_VERSION` (`lib/cli-version.ts`) | `1.9.3` (env override `BK_CLI_LATEST`) |
| `CLI_MIN_VERSION` (`lib/cli-version.ts`) | **`1.9.1`** (env override `BK_CLI_MIN`) |

**`cli/` is byte-identical to tag `v1.9.3`** — `git diff v1.9.3..HEAD -- cli/` is
empty. The only commit since that tag deleted a planning document. So a published
binary matching pre-migration behaviour **already exists**; no fresh release is
required to satisfy Phase 0 step 4.

**The floor must not move until Phase 8.** `CLI_MIN_VERSION` stays at `1.9.1`
for the whole migration.

### `bk --help` — command groups (baseline shape, pre-namespacing)

Top-level commands, exactly as they exist today. Phase 5 moves the app nouns
behind `bk issues …`; every one of these spellings must survive as a deprecated
alias.

```
activity     analytics    changelog    completion   copy
guide        help         inbox        invite       issue
label        login        logout       member       meta
move         profile      project      skill        storage
super-admin  task         token        trash        undo
upload       user         version      whoami       workspace
```

Documented group summaries from the help text:

```
guide       the embedded usage guide (--list, <topic>, --json)
skill       install / check / sync the agent skill file
workspace   list, show, create, edit, transfer, use
move/copy   move (or copy) projects/tasks/issues to another workspace (--to)
project     list, view, create, edit, delete, members, updates, comment(s)
issue       list, view, create, edit, delete, assign, watch, comment(s),
            edit-comment, delete-comment, attach, detach, activity
task        list, view, create, edit, delete, comment(s)
label       list, view, create, delete, attach, detach
member      list, remove, leave
invite      send, list, accept, decline, revoke, pending, candidates
token       list, create, delete
profile     view, edit
inbox       list, read, archive, unarchive
upload      upload a file and print its url
storage     list, rm, attachments (workspace owner)
trash       list, restore, purge, empty
undo        roll back your last N writes
activity    workspace activity feed (paginated)
analytics   workspace analytics
changelog   the dated record of what changed
super-admin users, whitelist, errors (super admins only; platform-wide)
```

**Exit codes (stable contract — must not change):**

```
0 ok   1 generic   2 usage   3 auth(401)   4 perm(403)
5 not-found(404)   6 validation(400/422)   7 user-aborted
8 client too old   9 update available
```

### `bk guide --list` — 13 topics

Flat today; Phase 5 splits these into `topics/platform/` and `topics/issues/`
and the slugs become `platform/<x>` / `issues/<x>`.

| slug | file |
|---|---|
| `overview` | `00-overview.md` |
| `install-auth` | `01-install-auth.md` |
| `workspaces` | `02-workspaces.md` |
| `items` | `03-items.md` |
| `rich-text` | `04-rich-text.md` |
| `files` | `05-files.md` |
| `storage` | `06-storage.md` |
| `move-copy` | `07-move-copy.md` |
| `output-and-exit-codes` | `08-output-and-exit-codes.md` |
| `undo-and-trash` | `09-undo-and-trash.md` |
| `encoding` | `10-encoding.md` |
| `pitfalls` | `11-pitfalls.md` |
| `staying-current` | `12-staying-current.md` |

### CLI ↔ route parity

From `cli/routes.json` (emitted by `make -C cli routes`, consumed by
`lib/cli-parity.test.ts`):

| | |
|---|---|
| route↔command pairs claimed by the CLI | **97** |
| leaf commands with no `routes` annotation | **0** |
| `app/api/**/route.ts` files on disk | **77** |

Parity test assertions currently green:

1. every leaf command declares its routes
2. every API route is reachable from `bk` (no uncovered capability)
3. every route the CLI claims actually exists (no drift)
4. every exclusion names a route that still exists

The `EXCLUDED_PATHS` / `EXCLUDED_OPERATIONS` maps live in
`lib/cli-parity.test.ts` and each entry carries a reason. Phase 5 must keep all
four assertions green while the commands move into per-app namespaces.

### Changelog

Single authored file: `docs/api-changelog.md`, newest first. Served by
`bk changelog` and `GET /api/changelog` via `lib/changelog.ts`.
Phase 5 splits it into `docs/changelog/platform.md` + `docs/changelog/issues.md`
by **moving** entries — never re-dating them.

---

## 4. Database — Neon

| | |
|---|---|
| Neon org | `Vercel: Balathanusan's projects` (`org-red-star-72246595`) |
| Neon project | `bc-issues` — **`muddy-butterfly-46798426`** |
| Region | `aws-eu-central-1` |
| Postgres version | 17 |
| Branches | **one**: `main` (`br-mute-rain-asktbp8p`), default, primary, **not protected** |
| Logical size | ~39 MB |
| **History retention** | **86 400 s = 24 hours** |
| Autoscaling | 1–2 CU, suspend timeout 0 |

> ### ⚠ The 24-hour retention window is the single most important number here.
>
> Neon point-in-time restore only reaches back **24 hours**. That is the entire
> "undo" budget for Phase 3 (`SET SCHEMA`), Phase 4 (access backfill), Phase 6
> and Phase 7. A migration discovered to be wrong on Monday cannot be restored
> from Friday's state.
>
> **Consequences for the plan:**
> - A pre-migration Neon *branch* (a real copy, retained until deleted) is the
>   only durable snapshot. Point-in-time restore is not a substitute.
> - Each risky phase needs its own snapshot branch taken immediately before it,
>   and the rehearsed rollback must be re-verified — not assumed.
>
> **Decided 2026-08-04:** raise retention to **7 days minimum before Phase 3**.
> The snapshot branch is kept regardless — *retention is the backstop, the branch
> is the plan.* Cost delta to be confirmed before the change is made.

### Schemas present

| schema | contents |
|---|---|
| `public` | all 26 application tables — the ones Phase 3 splits |
| `drizzle` | `__drizzle_migrations` (the migration ledger) — **splits per schema in Phase 3, see below** |
| `neon_auth` | 9 tables (`user`, `session`, `account`, `organization`, …) — **provisioned by the Neon integration, not used by this app.** Auth is next-auth against `public.users`. **Decided 2026-08-04: leave it alone.** Do not move it, do not drop it, do not grant an app role on it. |

### Decided 2026-08-04 — the migration ledger is **per schema**, not shared

Phase 3 creates `platform.__drizzle_migrations` and `issues.__drizzle_migrations`.
The single `drizzle.__drizzle_migrations` ledger does not survive into the
platform layout.

**Why:** apps deploy independently. One shared ledger couples every app's deploy
to every other app's — a `sales` migration lands a row that an `issues` deploy
then sees as unapplied history it knows nothing about, and `drizzle-kit migrate`
has no way to tell whose row is whose. Per-schema ledgers make each app's
migration history its own, which is the same boundary the per-app Postgres roles
draw for data.

Consequence for Phase 3: each schema needs its own `drizzle.config.ts`
(`migrations: { schema: '<app>' }`) and its own `out` directory, and the existing
ledger rows must be split between the two — not copied to both. Rehearse it on a
branch like any other migration.

### The 26 tables and their Phase 3 destination

Row counts are `pg_stat_user_tables.n_live_tup` (approximate) on `main` at
capture time. **Phase 3 must show these unchanged after `ALTER TABLE … SET
SCHEMA`.**

**→ `platform` schema (16 tables)**

| table | ~rows |
|---|---|
| `users` | 14 |
| `workspaces` | 16 |
| `workspace_members` | 41 |
| `workspace_counters` | 16 |
| `workspace_invitations` | 38 |
| `api_tokens` | 19 |
| `password_reset_otps` | 1 |
| `email_whitelist` | 4 |
| `uploads` | 101 |
| `comments` | 288 |
| `labels` | 33 |
| `events` | 3 547 |
| `inbox_messages` | 875 |
| `transaction_log` | 0 |
| `deletion_batches` | 314 |
| `error_events` | 2 |

**→ `issues` schema (10 tables)**

| table | ~rows |
|---|---|
| `issues` | 652 |
| `tasks` | 68 |
| `projects` | 70 |
| `project_updates` | 1 |
| `issue_labels` | 118 |
| `issue_assignees` | 327 |
| `issue_watchers` | 922 |
| `project_labels` | 0 |
| `project_members` | 0 |
| `attachments` | 24 |

16 + 10 = 26. Matches `PLATFORM-ARCHITECTURE.md` §4.3 exactly — no table is
unaccounted for, and no table is claimed by both.

**Open question for Phase 3:** the Drizzle ledger lives in `drizzle.__drizzle_migrations`,
outside both new schemas. Decide there whether it stays put (one shared ledger)
or splits per app, and write the decision into `docs/platform-db.md`.

### Population size (relevant to Phase 4)

14 users, 16 workspaces, 41 workspace memberships. Small enough that the
orphaned-member query in Phase 4 can be *enumerated*, not sampled — which is
exactly why the plan prefers exhaustive verification over a soak period.

---

## 5. Environment variables

### Vercel project

| | |
|---|---|
| Project | `bc-issues` (`prj_bueHX5y2f7uaemskB5Q1Plwbry2p`) — name unchanged by the repo rename |
| Team/org | `balathanusans-projects-f76f8a7b` (`team_b4wX7DvsnUaeqJyLi5cGrlbQ`) |
| Region | `fra1` (from `vercel.json`) |
| Framework | nextjs; build `npm run build`, install `npm install` |
| Node | 24.x |
| **Root Directory** | **`.`** — Phase 1 changes this to `apps/issues` |
| Domains | `issues.blackcode.ch` (primary), `bc-issues.vercel.app`, two auto-generated |

`issues.blackcode.ch` is **already** live on this project. That is the subdomain
architecture §8 assumes, so the Phase 4 cookie-domain change to `.blackcode.ch`
has a real host to work against on day one.

### ⚠ The project is not Git-connected — every deploy is a manual CLI deploy

`vercel ls bc-issues` shows every deployment, back 32 days, with:
`Environment = Production`, `Username = balathanusan-9149`. There is **no**
Git-triggered build and **no preview deployment has ever existed**. Production is
shipped by `devops/release.sh web`, which runs `vercel --prod` from the local
working copy.

Three consequences the plan does not account for:

1. **The repo rename cannot break the deploy pipeline** — nothing in it reads the
   GitHub repo name. (Good news; it is why the rename was safe to do first.)
2. **Phase 1 step 6 — "set the ignored-build step to `npx turbo-ignore`" — is a
   no-op today.** `turbo-ignore` only runs for Git-triggered builds. Configure it
   anyway so it is correct the day a second app arrives, but do not expect it to
   do anything, and do not treat it as verification that filtered builds work.
3. **Phase 1's "deploy a preview and click through" needs a preview deploy to be
   invented, not just enabled** — `vercel` without `--prod`, plus Preview env
   vars, which is the blocker below.

### Production (29 variables — the only environment with any)

Grouped by origin. This grouping is what Phase 1/3 needs when the project's Root
Directory changes and what `docs/env.md` gains a platform/app split from later.

**App-owned (7)** — set by hand, must be carried to every future app's project:

| name | notes |
|---|---|
| `DATABASE_URL` | the connection string the app actually uses. **Phase 3 swaps this to the `issues_app` role.** Record the current value before changing it. |
| `NEXTAUTH_SECRET` | **shared across apps** once the cookie is scoped to `.blackcode.ch` (Phase 4) — every app must use the *same* secret or the shared session cannot be decrypted. |
| `NEXTAUTH_URL` | per-app (per-subdomain). |
| `SUPER_ADMINS` | comma-separated emails. Platform-level. |
| `GOOGLE_CLIENT_ID` | OAuth. Redirect URI is per-subdomain — Phase 4/8 must add each new one. |
| `GOOGLE_CLIENT_SECRET` | OAuth. |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | transactional email (2 vars; added 29 d ago, the rest 50 d ago). |

**Blob-integration-provided (3):** `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID`
(`store_YV5Czdmvv…`), `BLOB_WEBHOOK_PUBLIC_KEY`.
Phase 7 keeps **one** store shared and adds a per-app path prefix — these three
values get copied to each new app's project, not re-provisioned.

**Neon-integration-provided (17, all `NEON_*`):** `NEON_DATABASE_URL`,
`NEON_DATABASE_URL_UNPOOLED`, `NEON_POSTGRES_URL`, `NEON_POSTGRES_URL_NON_POOLING`,
`NEON_POSTGRES_URL_NO_SSL`, `NEON_POSTGRES_PRISMA_URL`, `NEON_POSTGRES_HOST`,
`NEON_POSTGRES_USER`, `NEON_POSTGRES_PASSWORD`, `NEON_POSTGRES_DATABASE`,
`NEON_PGHOST`, `NEON_PGHOST_UNPOOLED`, `NEON_PGUSER`, `NEON_PGPASSWORD`,
`NEON_PGDATABASE`, `NEON_PROJECT_ID`, `NEON_AUTH_BASE_URL`,
`NEON_VITE_NEON_AUTH_URL`.

These are injected by the Neon Vercel integration and are **not** what the app
reads — the app reads `DATABASE_URL`. They point at the integration's role, so
after Phase 3 they will describe a *different* (more privileged) role than the
app uses. Treat them as informational; do not repoint the app at them.

### ⚠ Preview and Development have **zero** environment variables

```
$ vercel env ls preview      → No Environment Variables found
$ vercel env ls development  → No Environment Variables found
```

**This blocks a step of Phase 1 as written.** Phase 1 says "deploy a Vercel
preview and click through: login, workspace switch, create an issue, upload a
file, comment." A preview deployment with no `DATABASE_URL`, `NEXTAUTH_SECRET`
or `BLOB_READ_WRITE_TOKEN` will not boot, so it cannot prove the monorepo move
is behaviour-preserving.

Resolve before Phase 1 verification, by one of:

1. Populate Preview env vars pointing at a **Neon branch** (the intended use of
   branches per architecture §4.2) plus the shared Blob token. Best long-term —
   Phases 3, 4, 6 and 7 all want a preview environment too.
2. Verify locally against `localhost:5434` and promote straight to production
   after a green build. Cheaper, weaker evidence.

Option 1 is the recommendation. It is a prerequisite, not part of Phase 1.

### Local (`.env.local`, 7 vars)

`DATABASE_URL` (→ `localhost:5434/blackcode_issues`), `NEXTAUTH_SECRET`,
`NEXTAUTH_URL`, `BLOB_READ_WRITE_TOKEN`, `SUPER_ADMINS`, `RESEND_API_KEY`,
`RESEND_FROM_EMAIL`. No Google OAuth locally.

---

## 6. Repo shape at baseline

Everything below is at the repo root today. Phase 1 moves the first group into
`apps/issues/`.

**Moves to `apps/issues/` (Phase 1):**
`app/` `components/` `lib/` `types/` `public/` `middleware.ts` `next.config.js`
`postcss.config.js` `tsconfig.json` `drizzle.config.ts` `vercel.json`
`vitest.config.ts` `components.json` `package.json` `next-env.d.ts`

**Stays at root:**
`cli/` `docs/` `devops/` `scripts/` `docker-compose.yml` `CLAUDE.md` `AGENTS.md`
`README.md` `PLATFORM-ARCHITECTURE.md` `PLATFORM-MIGRATION-PLAN.md`
`ENV_TEMPLATE.md`

**Not covered by the plan — decide during Phase 1:** `First-release.md`,
`HANDOVER.md`, `AGENT-PROMPT.txt`, `gitIgnore/`, `scratchpad/`,
`.playwright-mcp/`, `tsconfig.tsbuildinfo`.

`docs/` at baseline: `api-changelog.md`, `architecture-rebuild.md`, `backend.md`,
`cli.md`, `devops.md`, `env.md`, `frontend.md`, `improvements.md`,
`marketing.md`, `next-fixes.md`, `specs/`, and this file under `migration/`.

---

## 7. Git

| | |
|---|---|
| Remote (was) | `https://github.com/blackcode-switzerland/bc-issues.git` |
| **Remote (now)** | `https://github.com/blackcode-switzerland/blackcode-platform.git` |
| Visibility | public |
| Branch | `main` |
| HEAD at capture | `47320b0c44ee48e0da0a73008c3365ec2fc95d39` (2026-08-04 10:33:49 +0200) |
| Latest release tag | `v1.9.3` |
| Baseline tag | `pre-platform-migration` (annotated, at `47320b0`) |
| CI | **none** — no `.github/` directory, no workflows |

### The rename (done 2026-08-04)

`gh repo rename blackcode-platform`. Both redirects were verified *after* the
rename, not assumed:

```
$ curl -sIL .../bc-issues/releases/download/v1.9.3/bk-v1.9.3-darwin-arm64
http_code=200                    # old release-asset URL still resolves

$ git ls-remote https://github.com/blackcode-switzerland/bc-issues.git HEAD
47320b0c44ee48e0da0a73008c3365ec2fc95d39   # old clone URL still resolves
```

That matters because **every npm version published so far (≤ 1.9.3) has the old
repo name baked into `install.js`**. The redirect is what keeps `npm i -g
@blackcode_sa/bc-issues@1.9.3` working, which is the documented rollback path in
§8. If GitHub ever drops the redirect — or someone creates a new repo named
`bc-issues` under the same org, which *does* break it — that rollback path dies.
**Do not create a repo named `bc-issues` in `blackcode-switzerland`.**

**Repointed to the new name** (they build URLs for *future* releases):

- `cli/npm/install.js` — `REPO` constant
- `cli/npm/package.json` — `repository.url`
- `devops/release.sh` — the `repo` var passed to `gh release create`
- the local `origin` remote

**Deliberately left on the old name:**

| Thing | Why |
|---|---|
| Go module path `github.com/blackcode-switzerland/bc-issues/cli` | never fetched by path (built from the checkout); renaming churns ~35 import lines for nothing |
| npm package `@blackcode_sa/bc-issues` | renaming a published package breaks every agent that has it installed. Plan defers the decision to Phase 8 |
| Vercel project `bc-issues`, `bc-issues.vercel.app` | Vercel resource names, unrelated to the repo |
| Neon project `bc-issues`, Blob store `bc-issues-blob`, Google OAuth client `bc-issues` | ditto — infrastructure resource names |
| `docs/api-changelog.md` | a dated log. History is not rewritten. |

---

## 8. How to restore

| What | How | Window |
|---|---|---|
| Code | `git checkout pre-platform-migration` | forever |
| Published CLI | `npm i -g @blackcode_sa/bc-issues@1.9.3` | forever (depends on the GitHub redirect — see §7) |
| Database (durable) | reset `main` from Neon branch `pre-platform-migration` | until that branch is deleted |
| Database (PITR) | Neon restore to a timestamp | **24 h only** |
| Vercel deployment | redeploy from the pre-migration checkout (`vercel --prod`) or promote `dpl_CHxo9nVz56JWiATgQakLc329S1FU` in the dashboard | Vercel retention |
| GitHub repo name | `gh repo rename bc-issues` | anytime |
| Env vars | this file, §5 — values are encrypted in Vercel and not reproduced here | — |

### The durable database snapshot

| | |
|---|---|
| Neon branch | **`pre-platform-migration`** |
| Branch ID | **`br-odd-art-as1amxb2`** |
| Parent | `main` (`br-mute-rain-asktbp8p`) |
| Created | 2026-08-04, before any migration work |

Contents verified against `main` at creation — exact counts, not estimates:

| | branch | main |
|---|---|---|
| tables in `public` | 26 | 26 |
| `users` | 14 | 14 |
| `workspaces` | 16 | 16 |
| `workspace_members` | 41 | 41 |
| `issues` | 652 | 652 |
| `projects` | 70 | 70 |
| `tasks` | 68 | 68 |
| `comments` | 288 | 288 |
| `uploads` | 101 | 101 |

**Keep this branch until Phase 8 completes.** It is the only database rollback
that outlives the 24-hour retention window. Deleting it early converts every
later phase from "revertible" to "same-day-revertible".

Restoring is `Reset from parent`-in-reverse: in the Neon console, reset `main`
from `pre-platform-migration`. **That has never been rehearsed** — Phase 3 must
rehearse it before it is relied on, per the plan's "a rollback you haven't run is
a hope, not a plan."
</content>
</invoke>
