# Blackcode Platform — CLAUDE.md

## Project overview

A **monorepo** (npm workspaces + Turborepo) holding Blackcode's internal apps.
Today there is exactly one: **`apps/issues`**, an AI-native issue tracker
(Linear-style). Next.js 16 App Router, TypeScript, Tailwind v4, Drizzle ORM +
PostgreSQL, next-auth, TanStack Query, Framer Motion.

The target architecture is `PLATFORM-ARCHITECTURE.md`; the ordered migration to
it is `PLATFORM-MIGRATION-PLAN.md`, with the pre-migration baseline in
`docs/migration/baseline.md`. **Phases 0–7 have landed; 8 has not.** So:

- `packages/platform-db`, `platform-api`, `platform-ui`, `platform-auth`,
  `platform-agent` and `platform-storage` exist.
  `platform-auth` holds per-app access, `bk_live_` tokens, the platform whitelist
  and password hashing; `platform-agent` holds the merged changelog feed and the
  advertised CLI versions. **`lib/auth.ts` (next-auth `authOptions`) deliberately
  did NOT move** — see the reason in `packages/platform-auth/src/index.ts`.
- The database is **`platform.*` + `issues.*`**, not `public` (Phase 3). Production
  runs as the bounded role `issues_app`; migrations run as `MIGRATE_DATABASE_URL`.
- Apps are real data (Phase 4): `platform.apps`, `workspace_apps`, `app_access`.
  Workspace listings are app-scoped and `resolveWorkspace` enforces access behind
  `PLATFORM_ENFORCE_APP_ACCESS`. See "Per-app access" in `docs/backend.md`.
- **The CLI is namespaced per app (Phase 5): `bk issues issue create`.** Every
  pre-1.10.0 spelling still runs as a deprecated alias that prints one stderr
  line, and is removed in 1.12.0. Guide topics, the changelog and the docs are
  split the same way. `CLI_MIN_VERSION` has **not** moved — that is Phase 8.
- **Everything is addressable by URN (Phase 6):**
  `bc:<app>:<workspace-slug>/<entity-type>/<number>`, using the #number. Every
  issue/task/project is projected into `platform.entities` **in the same
  transaction as its source write**; `platform.links` relates any two URNs;
  `platform.events` carries `app` + `subject_urn`. That powers `bk search`,
  `bk link` and a cross-app `bk activity`. The projection is derived data — read
  `apps/issues/lib/db/queries/entities.ts`'s header before touching a write path,
  and `bk super-admin entity-drift` is the reconciler that proves it has not
  drifted.
- **Storage is shared and app-attributed (Phase 7):** `platform.uploads.app`
  records who uploaded each file, new uploads land under
  `<app>/<workspace>/<file>`, and **existing blobs were not moved** — `pathname`
  is where a file is, `app` is who owns it. Reference counting is a **registry**:
  each app registers a scanner (`apps/issues/lib/storage/`), and the platform
  refuses to answer — not answers "no references" — when any enabled app has no
  scanner. Read `packages/platform-storage/src/references.ts`'s header before
  touching anything that can reach `del()`; that file is the only thing standing
  between a code change and unrecoverable data loss. Import storage from
  `@/lib/storage`, never from the package directly.
- Still not done (Phase 8): `apps/_template/`, raising `CLI_MIN_VERSION`,
  tightening `events.app` and `uploads.app` to NOT NULL.

## Repo layout

```
apps/issues/          the issue tracker — app/ components/ lib/ types/ docs/ public/
cli/                  the `bk` Go binary (repo root — shared by every app)
  internal/commands/platform/   bare verbs: workspace, label, upload, trash, …
  internal/commands/issues/     that app's nouns, behind `bk issues …`
  internal/cmdutil/             what both need; the app packages never import each other
  internal/guide/topics/{platform,issues}/
packages/             shared libraries — see the list above; apps import these,
                      never each other
docs/                 PLATFORM docs only (see the Docs sync rule)
docs/changelog/       one file per app + platform.md — merged by `bk changelog`
devops/               release scripts
turbo.json            task pipeline
tsconfig.base.json    shared TS settings; apps extend it
```

## Dev commands

**Run these from the repo root.** They delegate through Turborepo.

```bash
npm run dev        # start dev server (port 3000) — turbo run dev --filter=issues
npm run build      # production build
npm run typecheck  # type check only  ← NOT `npx tsc --noEmit`
npm test           # vitest, incl. the CLI-parity guard
```

> **`npx tsc --noEmit` no longer works from the repo root** — there is no root
> `tsconfig.json`, by design: a root config that compiled nothing would report a
> vacuous green. Use `npm run typecheck`, or `cd apps/issues && npx tsc --noEmit`.

> **`npm run build` does not touch a database.** The `postbuild` hook only
> migrates when `RUN_MIGRATIONS` is set, which is true in Vercel Production only.
> See `apps/issues/scripts/migrate-if-enabled.mjs`.

## Key architecture

- **`apps/issues/app/`** — Next.js App Router pages + API routes
- **`apps/issues/components/`** — shared UI components; `apps/issues/components/ui/` = primitives
- **`apps/issues/lib/db/`** — Drizzle schema (`schema.ts`), migrations (`migrations/`), query helpers (`queries/`)
- **`apps/issues/lib/`** — auth, utils, work-item constants

## Design system

See memory file `design-system.md` for full details. Short version:

- **Theme**: monochrome Linear-style. `--primary: #007bd3`. Tokens in `apps/issues/app/globals.css`.
- **Dark/light**: `next-themes`, class strategy, `defaultTheme="dark"`.
- **Status/priority colors**: canonical in `apps/issues/lib/work-items.ts` — never hardcode elsewhere.
- **Dialogs**: `useConfirm()` from `apps/issues/components/ui/confirm-dialog.tsx` — never `window.confirm/prompt`.
- **Toasts**: `sonner` — `toast.success` / `toast.error` on all mutations.
- **Page layout**: slim sticky header (`h-11 border-b`), borderless edge-to-edge list rows, no card wrappers in listings.

## Rich text editor

`apps/issues/components/rich-text-editor.tsx` — TipTap-based, used everywhere for descriptions and comments.

- **Slash command** (`/`): H1–H4, Bold, Italic, Strike, Underline, Link, Quote, Code block, Bullet list, Numbered list, Checklist, Table, Attach file.
- **BubbleMenu** (on text selection): full formatting bar — B, I, Strike, Underline, Code, H1–H4, Bullet, Numbered, Checklist, Quote, Link.
- **Table menu** (cursor inside a table, no selection): add/delete row & column, toggle header row, delete table. Tables round-trip everywhere (editor, read-only display, gfm Markdown, HTML, CLI/API) via `@tiptap/extension-table*`; the server (`apps/issues/lib/rich-text.ts`) and render-layer (DOMPurify) sanitizers both whitelist the table markup.
- `variant="bordered"` for modals/forms; `variant="seamless"` for detail-page descriptions.
- `hideToolbar` — create-issue-modal sets this; formatting via slash + bubble menus only.
- `onFileUpload?: (file: File) => Promise<string>` — pass `/api/upload` handler to enable paste/drag-drop/slash-attach for **any file type**. Images/video/audio preview inline; PDF gets View+Download; other files get a Download card. After upload, cursor moves to a new line below the attachment.
- `mentionItems` — pass `members.map(m => ({id, label, avatarUrl}))` to enable `@mention` dropdown.

## Create-item UX pattern

"New issue / task / project" buttons **do not open a modal**. They POST a minimal record immediately, then `router.push` to the detail page with `?new=1`. On the detail page, `useSearchParams()` detects `?new=1` and auto-focuses + selects the title field so the user can rename right away.

- Issue listing → `POST /api/workspaces/:slug/issues { title: 'New Issue' }` → `/dashboard/issues/:id?new=1`
- Task listing → `POST /api/workspaces/:slug/tasks { name: 'New Task' }` → `/dashboard/tasks/:id?new=1`
- Project listing → `POST /api/workspaces/:slug/projects { name: 'New Project' }` → `/dashboard/:id?new=1`
- Inside project detail: "New issue" / "New task" pre-set `project_id`; per-task "+" also pre-sets `task_id`.
- Inside task detail: "New issue" pre-sets `task_id` (and `project_id` if the task belongs to one).

The three old create-modal files (`issue-create-modal.tsx`, `task-create-modal.tsx`, `project-create-modal.tsx`) have been deleted. `create-issue-modal.tsx` still exists for the kanban "create issue" flow.

## Data fetching

TanStack Query throughout. See memory file `sync-architecture.md` for query key hierarchy, optimistic update patterns, and cache invalidation rules.

## Super admin

Controlled via `SUPER_ADMINS` env var (comma-separated emails) + `email_whitelist` DB table. Pages at `/dashboard/super-admin`. See memory file `super-admin.md`.

## Agent surface contract (MANDATORY)

Agents operate this product through **one** interface: the `bk` CLI. The HTTP
API is **private plumbing with no public contract** — do not document it for
external consumers, and **never reintroduce an OpenAPI spec or a fat page
manifest.** Both were deleted on 2026-08-03: they were hand-maintained copies of
facts that lived elsewhere, and they had already drifted (the manifest claimed
uploads accept any file type; SVG is rejected. The platform reference described
a `GET /api/upload` field that never existed, and pinned a stale CLI version).

**The `/api/openapi.json` and `/api/docs` ROUTES still exist, and are meant to.**
The documents are gone; what remains is a 410 Gone carrying a `suggestion`
(`app/api/openapi.json/route.ts`, `lib/api/retired.ts`). A 410 with a suggestion
is something an agent working from stale context can act on inside the same run —
it names the fix. A 404 just looks like a bug, and the agent retries or gives up.
They are excluded from the CLI-parity test with that reason, they have no `bk`
command by design, and they have no expiry: an agent carrying a two-year-old
prompt can turn up at any time. Do not "clean them up".

### Where knowledge lives

Two homes, and the split is the whole trick:

| Kind | Home | Why |
|---|---|---|
| **Static** — how the tool behaves: flag names, exit codes, the upload→embed flow, the UTF-8 warning | `cli/internal/guide/topics/*.md`, `//go:embed`-ed, served by `bk guide` | It describes *this binary*. Fetching it from the server would describe a version the agent isn't running — worse than being out of date. |
| **Dynamic** — what the data is right now: statuses, priorities, health, workspaces, size caps, blocked MIME types | the server, via `GET /api/meta` → `bk meta` (assembled in `apps/issues/lib/agent-meta.ts`) | Changes without a CLI release. |

**A guide topic must never restate a dynamic value.** Write *"run `bk meta` for
the current status values"*, not the values. `cli/internal/guide/guide_test.go`
fails the build if a topic hardcodes one.

Likewise, **a limit is declared once** in `apps/issues/lib/limits.ts`, imported by the route
that enforces it, and served by `/api/meta`. Never re-type a number.

### THE RULE: every change lands in three places

> **Route → `bk` command → changelog entry.** Same commit, every time.
>
> | # | Edit | Where |
> |---|---|---|
> | **1** | The **route** | `apps/issues/app/api/**` |
> | **2** | The **`bk` command** + its `routes` annotation | `cli/internal/commands/<app>/` or `platform/`, `cli/internal/client/` |
> | **3** | A dated **changelog** entry | `docs/changelog/<app>.md`, or `platform.md` |
>
> Plus **one conditional fourth**: if agent-visible *behaviour* changed (a flag, a
> workflow, a failure mode), update the relevant
> `cli/internal/guide/topics/{platform,<app>}/*.md`.
> If only a *value* changed (a limit, an enum), touch its source instead —
> `bk meta` carries it live and no guide edit is needed.

This replaced a seven-surface contract on 2026-08-03. Do not add a fourth
unconditional step, and never reintroduce a hand-maintained copy of facts that
live elsewhere — that is what drifted last time and what broke agents mid-run.

The detail behind each step:

1. **Route** — `apps/issues/app/api/**`, same conventions as before: workspace-scoped under
   `/api/workspaces/{ws}/…`; auth + errors via `apiHandler` + `Errors`
   (`apps/issues/lib/api`); lists return `{ data, next_cursor }` via `jsonList()`; single
   resources return the bare entity; create → `201`, delete → `{ deleted: true }`.
   Never reintroduce implicit-active-workspace ("legacy") routes.
2. **CLI** — add or update the `bk` command + the client method in
   `cli/internal/client/`, **and its `routes` annotation**:

   ```go
   Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/issues"},
   ```

   Use the literal `"none"` when the command makes no HTTP call. `"none"` is
   required rather than allowed-to-be-empty so an oversight stays visible.
   Reuse `wsPath()` for workspace-scoped calls and unwrap the
   `{ data, next_cursor }` envelope. Keep JSON/YAML output + stable exit codes.
3. **Changelog** — see the Changelog rule below. One dated entry at the top of
   the right file in `docs/changelog/`: what changed, whether it's breaking, how
   to adapt. A change touching shared platform data goes in `platform.md`, **not**
   in the app that happened to prompt it.

**Conditional — only when the situation applies:**

- **Guide** — if agent-visible *behaviour* changed (a flag, a workflow, a failure
  mode), update the relevant `cli/internal/guide/topics/platform/*.md` (true
  everywhere) or `topics/<app>/*.md` (one app). A topic under `topics/<app>/` may
  not describe another app; `guide_test.go` enforces it.
- **`bk meta`** — if a vocabulary or limit changed, update its *source*
  (`apps/issues/lib/work-items.ts`, `apps/issues/lib/limits.ts`, `apps/issues/lib/upload.ts`); `/api/meta` and
  `bk meta` follow automatically via `apps/issues/lib/agent-meta.ts`. Never edit a guide
  topic to state a value — that's the drift we removed.
- **Deprecations** — if you renamed or removed a flag/command, add a row to
  `cli/internal/commands/deprecations.go` **in the same commit**. Keep entries
  for two minor releases, then prune. This is what lets a failed run recover
  itself: the CLI prints the new spelling instead of "unknown flag".
- **Server `suggestion`s** — any 400/404/409 an agent can realistically hit
  should carry an actionable `suggestion` (`Errors.badRequest(code, msg, 'do X')`).
  The CLI surfaces it as a `hint:` line on stderr.
- **Internal docs** — see the Docs sync rule below (`docs/backend.md`,
  `docs/cli.md`, `docs/frontend.md`, `docs/marketing.md`). These are
  **maintainer** docs, not an agent surface — but they still must not contradict
  the CLI-only contract.

### The guardrail

`apps/issues/lib/cli-parity.test.ts` (run by `npm test`) fails the build if:

- a real route+method has **no `bk` command** (a capability agents can't reach), or
- the CLI **claims a route that doesn't exist** (drift), or
- a leaf command declares **no `routes` annotation** at all.

Genuine non-CLI routes (browser auth flows, telemetry beacons, the status page)
live in that file's `EXCLUDED_PATHS` / `EXCLUDED_OPERATIONS` maps — **each entry
must carry a reason.** An unexplained exclusion is how coverage quietly rots.

**Reach for an exclusion last.** Writing the annotations is what surfaces the
holes: it found four routes with no command, and for `label edit`, `undo --log`,
`issue watch --status` and `workspace delete`, "exclude it" would have been a lie
about what agents can do. Only two exclusions are real capability decisions, and
both are account/workspace destruction the product deliberately keeps human:
`DELETE /api/me` (an agent must never delete its owner's account — settled,
don't revisit) and the two board-ordering `PATCH …/reorder` routes, which are
meaningless outside the drag-and-drop UI.

The other Go guardrails:

- `cli/internal/commands/routes_test.go` — every leaf command has a `routes`
  annotation.
- `cli/internal/guide/guide_test.go` — no guide topic hardcodes a dynamic value.
- `cli/internal/skill/skill_test.go` — the skill template stays thin: under 40
  lines, and never names a route, an enum or an auth header.
- `cli/internal/commands/groups_test.go` — a mistyped subcommand is an error,
  never a silent help-and-exit-0.

### Writing commands agents can survive

Three rules learned the hard way; all four Go tests above exist to enforce one.

- **`Confirm()` is not a guard for agents.** It auto-approves under
  `BK_NO_PROMPT=1` and on a non-TTY — exactly how agents run. For anything
  irreversible, require the caller to *repeat the target back*
  (`bk workspace delete <slug> --confirm <slug>`), and require it even with
  `--yes`. Take the target as an explicit argument; never fall back to the active
  workspace for a destructive call.
- **Every failure must be a non-zero exit with one line on stderr.** Exit codes
  are the contract (`cmd/bk/main.go` owns the table); stdout stays parseable.
  Cobra's defaults fight this — it prints errors the CLI already prints, and it
  answers an unknown subcommand with help and exit 0. `SilenceErrors` and
  `rejectUnknownSubcommands()` in `root.go` correct both.
- **A dead end must name its own exit.** `hintFor()` in `main.go` turns a failure
  into a recovery: the server's `suggestion`, the `deprecations.go` row, or the
  generic "run `bk skill sync`". If you add a failure mode an agent can hit,
  check it lands on one of those paths.

Before finishing any API/feature change, run **from the repo root**:

```bash
npm run typecheck              # NOT `npx tsc --noEmit` — see Dev commands
npm test
npm run build
cd cli && go build ./... && go vet ./... && go test ./...
cd cli && make routes          # if any `routes` annotation changed
```

See `AGENTS.md` for the short version.

### Releasing

`./devops/release.sh cli minor` (GitHub + npm; needs `npm login` + an OTP) and
`./devops/release.sh web` (Vercel production). Both are interactive.

`CLI_MIN_VERSION` in `packages/platform-agent/src/cli-version.ts` hard-blocks every older binary with
exit 8. **Publish to npm before raising it** — raise it first and every user is
locked out with nothing to upgrade to. Both versions are overridable by env
(`BK_CLI_LATEST` / `BK_CLI_MIN`), so the floor moves and rolls back without a
redeploy.

## Changelog rule (MANDATORY)

We publish a changelog so AI agents can keep their integrations and skills up to
date. It is an **agent** surface — served two aligned ways from one source:
**`bk changelog`** and **`GET /api/changelog`** (JSON, or `?format=markdown`).
Both read from `packages/platform-agent/src/changelog.ts`, which merges **one authored
Markdown file per section**, newest first, tagging each entry with where it came
from:

- **`docs/changelog/platform.md`** — identity, workspaces, membership, per-app
  access, labels, uploads, tokens, trash, undo, and the `bk` CLI itself.
- **`docs/changelog/<app>.md`** — one per app; today just `issues.md`.

`bk changelog` and `GET /api/changelog` serve the merged feed; `--app <name>` /
`?app=<name>` filter to one file. Files are discovered by reading the directory,
so adding an app is adding a file — there is no registry to keep in step.

Split from the single `docs/api-changelog.md` on 2026-08-04: one file per app
because a single file becomes a merge-conflict magnet across app teams and does
not survive an app extraction. **The whole pre-split record was moved verbatim
into `issues.md`** — including entries that describe platform concerns — because
sorting history into a taxonomy invented afterwards is rewriting it.

The **`/changelog` web page was removed on 2026-08-03** — it had no human
audience, and a page nobody reads is still a page somebody has to keep honest.
Do not reintroduce it. The record itself is unchanged; only the human rendering
is gone.

There is deliberately no pinned "platform reference" any more. A hand-maintained
snapshot of the surface is a copy, and copies drift — that one's CLI version was
already stale when we retired it. The current surface is `bk guide`, which ships
inside the binary and therefore always matches the binary being run.

> **The rule:** any change to an API route or a user-facing feature MUST be
> reported in the right `docs/changelog/*.md` file in the **same** change, as a new
> `## YYYY-MM-DD — <clear title>` entry at the top. Write it clearly and in
> detail: what changed, whether it's breaking, and how a client should adapt
> (with the new CLI command). Use a real, absolute date. **A change touching
> shared platform data goes in `platform.md`, not in the app that prompted it.**

This keeps every consumer able to self-update: an agent that hits a wall runs
`bk skill sync`, then `bk guide` for current usage and `bk changelog` for the
dated record. `/agent-updator` is the human-and-agent-readable migration page.

## Docs sync rule

**After every code change, check whether any file in `docs/` is now outdated or incomplete, and update it before finishing.** This is mandatory, not optional.

These are **maintainer** docs. They are not read by agents — agents read
`bk guide` — so they are free to describe internals, but they must never
contradict the CLI-only contract.

**Docs live in two places, and the split is load-bearing**
(PLATFORM-ARCHITECTURE.md §7.5): **root docs never describe an app's internals,
and an app's docs never describe another app.**

`/docs` — the platform and the monorepo itself:

- `docs/backend.md` — shared API conventions, auth, `platform.*` schema, per-app access, the event spine
- `docs/frontend.md` — theme + tokens, `components/ui/` primitives, app shell, workspace-scoped URLs, data fetching
- `docs/cli.md` — CLI internals, build, release, version policy
- `docs/marketing.md` — positioning, landing-page copy, FAQ seed
- `docs/devops.md`, `docs/env.md` — release process, environment variables
- `docs/changelog/` — the dated record, one file per app plus `platform.md`

`/apps/<app>/docs` — that app only:

- `apps/issues/docs/backend.md` — the `issues.*` schema, its routes, the `#number` model, its query layer
- `apps/issues/docs/frontend.md` — its dashboard routes, feature components, analytics view
- `apps/issues/docs/history/` — superseded design notes, kept as history

Rules:
- If you add/remove/rename a component, API route, DB table, env var, or command → update the relevant doc.
- If you change behavior (auth flow, data fetching pattern, UX pattern) → update the relevant doc.
- If new functionality has no doc coverage yet → add a section.
- Do NOT add docs for implementation details already obvious from the code; only document intent, contracts, and non-obvious constraints.
- **Never present the HTTP API as a way to use the product.** This applies to
  `docs/marketing.md`, `README.md`, `apps/issues/components/landing-page.tsx` and
  `/llms.txt` especially — outward-facing copy is how a wrong integration gets
  started. Two ways in: the web UI for humans, `bk` for agents.
- **Ask which layer it belongs to before writing:** *would a second app need this
  unchanged?* Yes → root. No → the app's own `docs/`.
- **Dated logs are history — don't rewrite them.** `docs/next-fixes.md` and
  `docs/changelog/*.md` record what was true on a date. If one has since become
  misleading, add a dated note at the top pointing at current practice.
