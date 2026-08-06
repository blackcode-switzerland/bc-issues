# Blackcode Platform — CLAUDE.md

## Project overview

A **monorepo** (npm workspaces + Turborepo) holding Blackcode's internal apps.

- **`apps/issues`** — an AI-native issue tracker (Linear-style). Next.js 16 App
  Router, TypeScript, Tailwind v4, Drizzle ORM + PostgreSQL, next-auth, TanStack
  Query, Framer Motion. This is the product.
- **`apps/_template`** — the scaffold. A real, minimal app: one entity, one
  route, one CLI command group, one guide topic, one page. It builds, lints and
  passes every guardrail. **Copy it to add an app; do not edit it in place.**

**The platform migration is finished — all nine phases (0–8) landed 2026-08-05.**

| Need | Read |
|---|---|
| **Add an app** | **`docs/adding-an-app.md`** — the authoritative, self-contained checklist. Copy `apps/_template`, follow it top to bottom |
| Current design rules | `docs/platform-architecture.md` |
| Why the repo looks like this | `docs/2026-08-platform-migration.md` — and what is **still owed** |
| Remove an app | `docs/extracting-an-app.md` |
| The database boundary | `docs/platform-db.md` |

What the migration bought:

- `packages/platform-{db,api,ui,auth,agent,storage,testing}` — seven shared
  libraries. Apps import these; apps never import each other.
  **`apps/issues/lib/auth.ts` (next-auth `authOptions`) deliberately did NOT
  move** — the reason is in `packages/platform-auth/src/index.ts`.
- The database is **`platform.*` + `issues.*`**, never `public`. Production runs
  as the bounded role `issues_app`; migrations run as `MIGRATE_DATABASE_URL`.
  See **`docs/platform-db.md`** — the boundary, the two credentials, the grants.
- Apps are real data: `platform.apps`, `workspace_apps`, `app_access`. Workspace
  listings are app-scoped and `resolveWorkspace` enforces access behind
  `PLATFORM_ENFORCE_APP_ACCESS`.
- **The CLI has three verb tiers, and the tier is visible in the spelling**
  (D-11, `bk guide platform/apps`). **Neutral** verbs stay bare because no app
  can be the wrong one to ask (`workspace`, `member`, `invite`, `token`,
  `profile`, `inbox`, `meta`, `login`, …). **Cross-app** verbs stay bare because
  crossing is the point, and tag each result with its app (`search`, `activity`,
  `link`, and `storage`, which lists every app's files against one workspace
  quota). **App-owned** verbs sit behind the app name — that is every app noun
  *and* `upload`, `trash`, `label`, which moved there in 3.0.0 because a file's
  ownership, a bin and a label each belong to ONE app. **You upload INTO one app
  and list ACROSS all of them** (D-28: the tier is decided by "would two
  deployments answer differently?", never by "is it shared code?"). The shared
  implementation is `cli/internal/appverbs`; each app group mounts it in one
  line and adds its own entity-specific subcommands.
- **Everything is addressable by URN:**
  `bc:<app>:<workspace-slug>/<entity-type>/<number>`, using the #number. Every
  issue/task/project is projected into `platform.entities` **in the same
  transaction as its source write**. Read `apps/issues/lib/db/queries/entities.ts`'s
  header before touching a write path; `bk super-admin entity-drift` is the
  reconciler.
- **Storage is shared and app-attributed.** `platform.uploads.app` records who
  uploaded each file; new uploads land under `<app>/<workspace>/<file>`;
  **existing blobs were not moved** — `pathname` is where a file is, `app` is who
  owns it. Import storage from `@/lib/storage`, never from the package directly.
- **Blob deletion works across deployments** via `platform.blob_references`, an
  index each app maintains **from Postgres triggers on its own content tables**.
  Read `packages/platform-db/src/schema.ts` at `blobReferences` before touching
  anything near it, and `packages/platform-storage/src/references.ts` before
  touching anything that can reach `del()`. Those two files are what stand
  between a code change and unrecoverable data loss.

Adding an app is a checklist, not a project: **`docs/adding-an-app.md`**, walked
end to end. Extracting one is **`docs/extracting-an-app.md`**, rehearsed.

## Repo layout

```
apps/issues/          the issue tracker — app/ components/ lib/ types/ docs/ public/
apps/_template/       the scaffold. Copy it; don't edit it
cli/                  the `bk` Go binary (repo root — shared by every app)
  internal/commands/platform/   bare verbs: workspace, label, upload, trash, …
  internal/commands/issues/     that app's nouns, behind `bk issues …`
  internal/commands/template/   the scaffold's, behind `bk template …`
  internal/cmdutil/             what both need; app packages never import each other
  internal/guide/topics/{platform,issues,template}/
packages/             shared libraries — apps import these, never each other
docs/                 PLATFORM docs only (see the Docs sync rule)
docs/changelog/       one file per app + platform.md — merged by `bk changelog`
docs/sql/             role creation, boundary probe, rollback scripts
devops/               release scripts
turbo.json            task pipeline
tsconfig.base.json    shared TS settings; apps extend it
```

## Dev commands

**Run these from the repo root.** They delegate through Turborepo.

```bash
npm run dev        # start dev server (port 3000) — turbo run dev --filter=issues
npm run build      # production build (every app)
npm run typecheck  # type check only  ← NOT `npx tsc --noEmit`
npm test           # vitest, incl. the per-app parity + isolation guards
npm run lint       # eslint, all apps and packages
```

> **`npx tsc --noEmit` does not work from the repo root** — there is no root
> `tsconfig.json`, by design: a root config that compiled nothing would report a
> vacuous green. Use `npm run typecheck`, or `cd apps/issues && npx tsc --noEmit`.

> **`npm run build` does not touch a database.** The `postbuild` hook only
> migrates when `RUN_MIGRATIONS` is set, which is true in Vercel Production only.

## Key architecture

- **`apps/issues/app/`** — Next.js App Router pages + API routes
- **`apps/issues/components/`** — shared UI; `components/ui/` = primitives
- **`apps/issues/lib/db/`** — Drizzle schema, migrations, query helpers
- **`apps/issues/lib/`** — auth, utils, work-item constants

## THE STANDING RULE: prove it fires

> **A check you have not watched fail is not a check.** Before claiming any
> guardrail, test, assertion or probe works, break the thing it guards and watch
> it go red. Then restore.

This is not a style preference. **Nine guardrails in this repo have been found
green-but-inert** — eight during the migration, and the count is still growing.
Every one looked like working protection:

| # | The check | How it was inert |
|---|---|---|
| 1 | ESLint on `platform-storage`, `-auth`, `-agent` | No config file at all. `eslint src` exited non-zero, `npm run lint` had been failing unnoticed, and three packages — including the one that can reach `del()` — had **no boundary rule enforced** |
| 2 | `platform.blob_refs_purge`'s authorisation guard | Compared `current_user`, which **inside a `SECURITY DEFINER` function is the function's owner, not the caller**. True for everybody |
| 3 | `docs/sql/blob-drift-check.sql`'s orphan detection | Structurally impossible: an orphan is byte-identical before and after a re-fire, so a diff can never surface one |
| 4 | The `apps/<a>` → `apps/<b>` ESLint rule | Three glob patterns, matching **none** of the imports that actually escape an app (`../../issues/lib/app` — the climb has no fixed depth and `apps` never appears in the specifier). **Survived its own diagnosis**: still green on the real escape shape four days later, sitting beside its working replacement. Deleted 2026-08-06 — `lib/app-isolation.test.ts` is the boundary; do not re-add a lint rule |
| 5 | `bk __routes` | Deduped on `method+path`, so two apps sharing a path collapsed into one and the second appeared to have **no commands**. Also silently dropped one claim on `GET /api/users` for months |
| 6 | `docs/sql/app-boundary-probe.sql` check (2) | **Commented out** — there was no second schema to point at when it was written. *A commented-out probe reports success.* Its first live version then picked `neon_auth.invitation`, a correct refusal of the wrong thing, which reads identically to a pass |
| 7 | `pg_dump --schema=issues` as an extraction | Emits the triggers and FKs, all of which fail at restore; `psql` prints 27 errors and **exits 0**. The database boots, serves, and has silently lost referential integrity and all blob-index maintenance |
| 8 | `TestRemovedSpellingsStillCarryAHint` | Asserted a **hand-written** cobra error string. The real one contains the whole remaining argv, so the three most-used spellings fell through to the generic hint. **Written by the same session that wrote this rule, an hour after writing it** |
| 9 | `guide_test.go`'s dynamic-value guard | A substring match over six hand-written strings. A topic containing the **entire** issue status vocabulary, the **entire** priority vocabulary and a **stale** `50 MB` limit passed every section. It banned `100MB` — the *correct* spelling — so the one case it could not catch was a topic that had gone out of date. Widened 2026-08-06 to match sizes by shape |

#8 is the one to remember: **you cannot tell by looking, including at your own.**
#4 and #9 were found by the wrap-up verification *after* the migration closed —
assume the next one exists.

Two corollaries worth stating separately, because they are different mechanisms:

- **A commented-out or skipped check reports success.** If a check cannot run
  yet, make it **skip loudly** (`RAISE NOTICE`, `t.Logf`, a non-empty assertion),
  never silently.
- **Assert your inputs.** Every "did we find anything to check?" assertion in
  this repo exists because a guard that found nothing would otherwise pass. #5
  was caught by exactly such an assertion.

## Design system

Full detail in `docs/frontend.md` (platform-wide) and
`apps/issues/docs/frontend.md` (this app). Short version:

- **Theme**: monochrome Linear-style. `--primary: #007bd3`. Tokens in `apps/issues/app/globals.css`.
- **Dark/light**: `next-themes`, class strategy, `defaultTheme="dark"`.
- **Status/priority colors**: canonical in `apps/issues/lib/work-items.ts` — never hardcode elsewhere.
- **Dialogs**: `useConfirm()` from `components/ui/confirm-dialog.tsx` — never `window.confirm/prompt`.
- **Toasts**: `sonner` — `toast.success` / `toast.error` on all mutations.
- **Page layout**: slim sticky header (`h-11 border-b`), borderless edge-to-edge rows, no card wrappers in listings.

## Rich text editor

`apps/issues/components/rich-text-editor.tsx` — TipTap-based, used for all descriptions and comments.

- **Slash command** (`/`): H1–H4, Bold, Italic, Strike, Underline, Link, Quote, Code block, Bullet list, Numbered list, Checklist, Table, Attach file.
- **BubbleMenu** (on selection): full formatting bar.
- **Table menu**: add/delete row & column, toggle header row, delete table. Tables round-trip everywhere via `@tiptap/extension-table*`; both the server (`lib/rich-text.ts`) and render-layer (DOMPurify) sanitizers whitelist the markup.
- `variant="bordered"` for modals/forms; `variant="seamless"` for detail-page descriptions.
- `hideToolbar` — create-issue-modal sets this.
- `onFileUpload?: (file: File) => Promise<string>` — pass the `/api/upload` handler to enable paste/drag-drop/slash-attach for **any file type**.
- `mentionItems` — pass `members.map(m => ({id, label, avatarUrl}))` for `@mention`.

> **Any new content column that can hold a file URL needs a
> `platform.blob_references` trigger, in the same migration.** The index is
> trigger-maintained so no *write path* can forget it, which concentrates the
> entire remaining risk here. See `docs/adding-an-app.md` step 4.

## Create-item UX pattern

"New issue / task / project" buttons **do not open a modal**. They POST a minimal
record immediately, then `router.push` to the detail page with `?new=1`, where
`useSearchParams()` auto-focuses the title field.

- Issue listing → `POST /api/workspaces/:slug/issues { title: 'New Issue' }` → `/dashboard/issues/:id?new=1`
- Task listing → `POST …/tasks { name: 'New Task' }` → `/dashboard/tasks/:id?new=1`
- Project listing → `POST …/projects { name: 'New Project' }` → `/dashboard/:id?new=1`
- Inside project detail: "New issue"/"New task" pre-set `project_id`; per-task "+" also pre-sets `task_id`.
- Inside task detail: "New issue" pre-sets `task_id` (and `project_id` if the task has one).

`create-issue-modal.tsx` still exists for the kanban "create issue" flow.

## Data fetching

TanStack Query throughout. See `docs/frontend.md` → data fetching.

## Super admin

`SUPER_ADMINS` env var (comma-separated emails) + `email_whitelist` table. Pages
at `/dashboard/super-admin`. Two reconcilers live here and both matter:

- **`bk super-admin entity-drift`** — `platform.entities` vs the source tables.
- **`bk super-admin blob-drift`** — `platform.blob_references` vs a live scan.
  Read `missing_count` first: a `missing` row is a file another deployment could
  delete while it is still in use. `unreconciled_count` is **not** drift — it is
  rows nobody looked at, and it exists because a clean report over a partial
  index is the most reassuring wrong answer this route can give.

## Agent surface contract (MANDATORY)

Agents operate this product through **one** interface: the `bk` CLI. The HTTP
API is **private plumbing with no public contract** — do not document it for
external consumers, and **never reintroduce an OpenAPI spec or a fat page
manifest.** Both were deleted on 2026-08-03: they were hand-maintained copies of
facts that lived elsewhere and had already drifted.

**The `/api/openapi.json` and `/api/docs` ROUTES still exist, and are meant to.**
The documents are gone; what remains is a 410 Gone carrying a `suggestion`
(`app/api/openapi.json/route.ts`, `lib/api/retired.ts`). A 410 with a suggestion
is something an agent on stale context can act on inside the same run; a 404 just
looks like a bug. They are excluded from the parity test with that reason, have
no `bk` command by design, and have no expiry. Do not "clean them up".

### Where knowledge lives

| Kind | Home | Why |
|---|---|---|
| **Static** — how the tool behaves: flags, exit codes, workflows, failure modes | `cli/internal/guide/topics/*.md`, `//go:embed`-ed, served by `bk guide` | It describes *this binary*. Fetching it from the server would describe a version the agent isn't running. |
| **Dynamic** — what the data is now: statuses, priorities, workspaces, size caps, blocked MIME types | the server, via `GET /api/meta` → `bk meta` (assembled in `apps/issues/lib/agent-meta.ts`) | Changes without a CLI release. |

**A guide topic must never restate a dynamic value.** Write *"run `bk meta` for
the current status values"*, not the values. `cli/internal/guide/guide_test.go`
fails the build if a topic hardcodes one.

Likewise, **a limit is declared once** in `apps/issues/lib/limits.ts` (or
`packages/platform-api/src/limits.ts` for shared ones), imported by the route
that enforces it, and served by `/api/meta`. Never re-type a number.

### THE RULE: every change lands in three places

> **Route → `bk` command → changelog entry.** Same commit, every time.
>
> | # | Edit | Where |
> |---|---|---|
> | **1** | The **route** | `apps/<app>/app/api/**` |
> | **2** | The **`bk` command** + its `routes` annotation | `cli/internal/commands/<app>/` or `platform/`, `cli/internal/client/` |
> | **3** | A dated **changelog** entry | `docs/changelog/<app>.md`, or `platform.md` |
>
> Plus **one conditional fourth**: if agent-visible *behaviour* changed (a flag, a
> workflow, a failure mode), update the relevant guide topic. If only a *value*
> changed, touch its source instead — `bk meta` carries it live.

1. **Route** — workspace-scoped under `/api/workspaces/{ws}/…`; auth + errors via
   `apiHandler` + `Errors`; lists return `{ data, next_cursor }` via `jsonList()`;
   single resources return the bare entity; create → `201`, delete →
   `{ deleted: true }`. Never reintroduce implicit-active-workspace routes.
2. **CLI** — add the command + client method, **and its `routes` annotation**:

   ```go
   Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/issues"},
   ```

   Use the literal `"none"` when the command makes no HTTP call — required rather
   than allowed-to-be-empty so an oversight stays visible. Reuse `wsPath()` and
   unwrap the `{ data, next_cursor }` envelope.
3. **Changelog** — one dated entry at the top of the right file. A change
   touching shared platform data goes in `platform.md`, **not** in the app that
   prompted it.

**Conditional:**

- **Guide** — behaviour changed → `topics/platform/*.md` (true everywhere) or
  `topics/<app>/*.md` (one app). A topic under `topics/<app>/` may not describe
  another app; `guide_test.go` enforces it.
- **`bk meta`** — a vocabulary or limit changed → update its *source*.
- **Deprecations** — renamed or removed a flag/command → add a row to
  `cli/internal/commands/deprecations.go` **in the same commit**. Keep entries
  for two minor releases, then prune. This is what lets a failed run recover.
- **Server `suggestion`s** — any 400/404/409 an agent can realistically hit
  should carry one (`Errors.badRequest(code, msg, 'do X')`). The CLI prints it as
  a `hint:` line.
- **Internal docs** — see the Docs sync rule.

### The guardrails

Every app carries two test files, copied from the scaffold:

- **`lib/cli-parity.test.ts`** — every route reachable from `bk`, every claimed
  route real. **Per app**: `bk __routes` tags each route with its app, and
  exactly one app sets `hostsPlatformRoutes` (today `issues`, because the shared
  routes physically live in its tree). Without that flag every platform route
  would go unchecked by everybody.
- **`lib/app-isolation.test.ts`** — no import resolving into another app, no
  query naming another app's schema. **Resolution-based, not glob-based** — see
  finding #4 above.

Genuine non-CLI routes live in `EXCLUDED_PATHS` / `EXCLUDED_OPERATIONS` — **each
entry must carry a reason.** Reach for an exclusion last; writing the annotations
is what surfaces the holes. Only two exclusions are real capability decisions,
both account/workspace destruction the product keeps human: `DELETE /api/me`
(settled — an agent must never delete its owner's account) and the two
board-ordering `PATCH …/reorder` routes.

The Go guardrails:

- `cli/internal/commands/routes_test.go` — every leaf command has a `routes` annotation.
- `cli/internal/guide/guide_test.go` — no hardcoded dynamic values; no cross-app references.
- `cli/internal/skill/skill_test.go` — the skill template stays under 40 lines and names no route, enum or auth header.
- `cli/internal/commands/groups_test.go` — a mistyped subcommand is an error, never a silent help-and-exit-0.
- `cli/internal/commands/boundaries_test.go` — command packages don't import each other.

### Writing commands agents can survive

- **`Confirm()` is not a guard for agents.** It auto-approves under
  `BK_NO_PROMPT=1` and on a non-TTY — exactly how agents run. For anything
  irreversible, require the caller to repeat the target back
  (`bk workspace delete <slug> --confirm <slug>`), even with `--yes`.
- **Irreversible commands report WHAT they did, not just how many.**
  `bk trash purge` echoes the type, #number and title of every item it destroyed,
  captured before the delete. A count alone is the difference between a wrong
  purge someone catches immediately and one nobody notices for a month.
- **Every failure is a non-zero exit with one line on stderr.** Exit codes are
  the contract (`cmd/bk/main.go` owns the table); stdout stays parseable.
- **A dead end must name its own exit.** `hintFor()` in `main.go` turns a failure
  into a recovery.

Before finishing any API/feature change, run **from the repo root**:

```bash
npm run typecheck              # NOT `npx tsc --noEmit`
npm test
npm run lint
npm run build
cd cli && go build ./... && go vet ./... && go test ./...
cd cli && make routes          # if any `routes` annotation changed
```

See `AGENTS.md` for the short version.

### Releasing

`./devops/release.sh cli minor` (GitHub + npm; needs `npm login` + an OTP) and
`./devops/release.sh web` (Vercel production). Both interactive.

**The order is: deploy web, then npm, then deploy web AGAIN.** The release script
bumps `CLI_LATEST_VERSION` in a commit it creates itself, so that commit lands
*after* the first web deploy — without the second deploy, production keeps
advertising the old version and no installed client is told an update exists.

`CLI_MIN_VERSION` in `packages/platform-agent/src/cli-version.ts` hard-blocks
every older binary with exit 8. **Publish to npm before raising it** — raise it
first and every user is locked out with nothing to upgrade to. Both versions are
overridable by env (`BK_CLI_LATEST` / `BK_CLI_MIN`), so the floor moves and rolls
back without a redeploy. Answer `normal`, never `forced`, unless raising the
floor is the deliberate point of that release.

## Changelog rule (MANDATORY)

We publish a changelog so AI agents can keep their integrations up to date. It is
an **agent** surface — served two aligned ways from one source: **`bk changelog`**
and **`GET /api/changelog`** (JSON, or `?format=markdown`). Both read from
`packages/platform-agent/src/changelog.ts`, which merges one authored Markdown
file per section, newest first:

- **`docs/changelog/platform.md`** — identity, workspaces, membership, per-app
  access, labels, uploads, tokens, trash, and the `bk` CLI itself.
- **`docs/changelog/<app>.md`** — one per app.

Files are discovered by reading the directory, so adding an app is adding a file.

> **The rule:** any change to an API route or a user-facing feature MUST be
> reported in the right `docs/changelog/*.md` file in the **same** change, as a
> new `## YYYY-MM-DD — <clear title>` entry at the top. Say what changed, whether
> it's breaking, and how a client should adapt. Use a real, absolute date.

The `/changelog` web page was removed on 2026-08-03 — it had no human audience.
Do not reintroduce it. There is deliberately no pinned "platform reference": the
current surface is `bk guide`, which ships inside the binary.

## Docs sync rule

**After every code change, check whether any file in `docs/` is now outdated, and
update it before finishing.** Mandatory.

These are **maintainer** docs — not read by agents (agents read `bk guide`) — so
they may describe internals, but must never contradict the CLI-only contract.

**Docs live in two places, and the split is load-bearing** (§7.5): **root docs
never describe an app's internals, and an app's docs never describe another app.**

`/docs` — the platform and the monorepo:

- `backend.md` — shared API conventions, auth, `platform.*` schema, per-app access, the event spine, the blob index
- `frontend.md` — theme + tokens, `components/ui/` primitives, app shell, data fetching
- `cli.md` — CLI internals, build, release, version policy
- `platform-db.md` — the database boundary, roles, grants, migrations
- `adding-an-app.md` — **the authoritative, self-contained checklist**
- `platform-architecture.md` — current design rules (was `PLATFORM-ARCHITECTURE.md`)
- `2026-08-platform-migration.md` — why the repo looks like this; what is still owed
- `extracting-an-app.md` — the rehearsed extraction
- `devops.md`, `env.md`
- `changelog/` — the dated record
- `sql/` — role creation, the boundary probe, rollback scripts
- `architecture-rebuild.md`, `specs/`, `next-fixes.md`, `migration/` — **historical**,
  each carrying a dated superseded note. Never follow as instructions

`/apps/issues/docs` — that app only: `backend.md`, `frontend.md`, `marketing.md`
(moved from root 2026-08-06 — it describes the app's landing page, which is an
app internal).

`/apps/<app>/docs` — that app only.

Rules:

- Add/remove/rename a component, route, table, env var or command → update the doc.
- Change behaviour → update the doc.
- New functionality with no coverage → add a section.
- Do NOT document implementation details obvious from the code; document intent,
  contracts and non-obvious constraints.
- **Never present the HTTP API as a way to use the product.** Two ways in: the
  web UI for humans, `bk` for agents.
- **Ask which layer it belongs to:** *would a second app need this unchanged?*
  Yes → root. No → the app's own `docs/`.
- **Dated logs are history — don't rewrite them.** `docs/next-fixes.md` and
  `docs/changelog/*.md` record what was true on a date. If one has become
  misleading, add a dated note at the top pointing at current practice.
- **A doc that prescribes a rejected design is worse than no doc.** When a
  decision supersedes something written down, rewrite the original rather than
  appending — docs/platform-architecture.md §4.6 was rewritten this way, because
  leaving the losing option in place is how the next person re-litigates it.
