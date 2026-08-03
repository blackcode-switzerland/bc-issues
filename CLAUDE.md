# Blackcode Issues — CLAUDE.md

## Project overview

AI-native issue tracker (Linear-style). Next.js 16 App Router, TypeScript, Tailwind v4, Drizzle ORM + PostgreSQL, next-auth, TanStack Query, Framer Motion.

## Dev commands

```bash
npm run dev      # start dev server (port 3000)
npm run build    # production build
npx tsc --noEmit # type check only
```

## Key architecture

- **`app/`** — Next.js App Router pages + API routes
- **`components/`** — shared UI components; `components/ui/` = primitives
- **`lib/db/`** — Drizzle schema (`schema.ts`), migrations (`migrations/`), query helpers (`queries/`)
- **`lib/`** — auth, utils, work-item constants

## Design system

See memory file `design-system.md` for full details. Short version:

- **Theme**: monochrome Linear-style. `--primary: #007bd3`. Tokens in `app/globals.css`.
- **Dark/light**: `next-themes`, class strategy, `defaultTheme="dark"`.
- **Status/priority colors**: canonical in `lib/work-items.ts` — never hardcode elsewhere.
- **Dialogs**: `useConfirm()` from `components/ui/confirm-dialog.tsx` — never `window.confirm/prompt`.
- **Toasts**: `sonner` — `toast.success` / `toast.error` on all mutations.
- **Page layout**: slim sticky header (`h-11 border-b`), borderless edge-to-edge list rows, no card wrappers in listings.

## Rich text editor

`components/rich-text-editor.tsx` — TipTap-based, used everywhere for descriptions and comments.

- **Slash command** (`/`): H1–H4, Bold, Italic, Strike, Underline, Link, Quote, Code block, Bullet list, Numbered list, Checklist, Table, Attach file.
- **BubbleMenu** (on text selection): full formatting bar — B, I, Strike, Underline, Code, H1–H4, Bullet, Numbered, Checklist, Quote, Link.
- **Table menu** (cursor inside a table, no selection): add/delete row & column, toggle header row, delete table. Tables round-trip everywhere (editor, read-only display, gfm Markdown, HTML, CLI/API) via `@tiptap/extension-table*`; the server (`lib/rich-text.ts`) and render-layer (DOMPurify) sanitizers both whitelist the table markup.
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

### Where knowledge lives

Two homes, and the split is the whole trick:

| Kind | Home | Why |
|---|---|---|
| **Static** — how the tool behaves: flag names, exit codes, the upload→embed flow, the UTF-8 warning | `cli/internal/guide/topics/*.md`, `//go:embed`-ed, served by `bk guide` | It describes *this binary*. Fetching it from the server would describe a version the agent isn't running — worse than being out of date. |
| **Dynamic** — what the data is right now: statuses, priorities, health, workspaces, size caps, blocked MIME types | the server, via `GET /api/meta` → `bk meta` (assembled in `lib/agent-meta.ts`) | Changes without a CLI release. |

**A guide topic must never restate a dynamic value.** Write *"run `bk meta` for
the current status values"*, not the values. `cli/internal/guide/guide_test.go`
fails the build if a topic hardcodes one.

Likewise, **a limit is declared once** in `lib/limits.ts`, imported by the route
that enforces it, and served by `/api/meta`. Never re-type a number.

### When you add / change / remove a route or feature

1. **Route** — `app/api/**`, same conventions as before: workspace-scoped under
   `/api/workspaces/{ws}/…`; auth + errors via `apiHandler` + `Errors`
   (`lib/api`); lists return `{ data, next_cursor }` via `jsonList()`; single
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
3. **Guide** — if agent-visible *behaviour* changed, update the relevant
   `cli/internal/guide/topics/*.md`.
4. **`bk meta`** — if a vocabulary or limit changed, update its source
   (`lib/work-items.ts`, `lib/limits.ts`, `lib/upload.ts`); `/api/meta` and
   `bk meta` follow automatically.
5. **Deprecations** — if you renamed or removed a flag/command, add a row to
   `cli/internal/commands/deprecations.go` **in the same commit**. Keep entries
   for two minor releases, then prune. This is what lets a failed run recover
   itself: the CLI prints the new spelling instead of "unknown flag".
6. **Server `suggestion`s** — any 400/404/409 an agent can realistically hit
   should carry an actionable `suggestion` (`Errors.badRequest(code, msg, 'do X')`).
   The CLI surfaces it as a `hint:` line on stderr.
7. **Docs** — see the Docs sync rule below (`docs/backend.md`, `docs/cli.md`,
   `docs/frontend.md`). These are **internal/maintainer** docs now, not an agent
   surface.
8. **Changelog** — see the Changelog rule below. One dated entry in
   `docs/api-changelog.md`.

### The guardrail

`lib/cli-parity.test.ts` (run by `npm test`) fails the build if:

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

Before finishing any API/feature change, run:

```bash
npx tsc --noEmit
npm test
cd cli && go build ./... && go vet ./... && go test ./...
cd cli && make routes          # if any `routes` annotation changed
```

See `AGENTS.md` for the short version.

### Releasing

`./devops/release.sh cli minor` (GitHub + npm; needs `npm login` + an OTP) and
`./devops/release.sh web` (Vercel production). Both are interactive.

`CLI_MIN_VERSION` in `lib/cli-version.ts` hard-blocks every older binary with
exit 8. **Publish to npm before raising it** — raise it first and every user is
locked out with nothing to upgrade to. Both versions are overridable by env
(`BK_CLI_LATEST` / `BK_CLI_MIN`), so the floor moves and rolls back without a
redeploy.

## Changelog rule (MANDATORY)

We publish a changelog so users and their AI agents can keep their integrations
and skills up to date. It is a product surface, not just a doc — served three
aligned ways from one source: the **`/changelog`** web page, **`GET
/api/changelog`** (JSON, or `?format=markdown`), and **`bk changelog`**. All read
from `lib/changelog.ts`, which renders **one** authored Markdown file:

- **`docs/api-changelog.md`** — the dated log, **newest first**. The running
  record of every change.

There is deliberately no pinned "platform reference" any more. A hand-maintained
snapshot of the surface is a copy, and copies drift — that one's CLI version was
already stale when we retired it. The current surface is `bk guide`, which ships
inside the binary and therefore always matches the binary being run.

> **The rule:** any change to an API route or a user-facing feature MUST be
> reported in `docs/api-changelog.md` in the **same** change, as a new
> `## YYYY-MM-DD — <clear title>` entry at the top. Write it clearly and in
> detail: what changed, whether it's breaking, and how a client should adapt
> (with the new CLI command). Use a real, absolute date.

This keeps every consumer able to self-update: an agent that hits a wall runs
`bk skill sync`, then `bk guide` for current usage and `bk changelog` for the
dated record. `/agent-updator` is the human-and-agent-readable migration page.

## Docs sync rule

**After every code change, check whether any file in `docs/` is now outdated or incomplete, and update it before finishing.** This is mandatory, not optional.

- `docs/frontend.md` — covers components, UI patterns, design system usage, page layouts
- `docs/backend.md` — covers API routes, DB schema, query helpers, auth, migrations
- `docs/cli.md` — covers dev commands, env vars, deployment, tooling

Rules:
- If you add/remove/rename a component, API route, DB table, env var, or command → update the relevant doc.
- If you change behavior (auth flow, data fetching pattern, UX pattern) → update the relevant doc.
- If new functionality has no doc coverage yet → add a section.
- Do NOT add docs for implementation details already obvious from the code; only document intent, contracts, and non-obvious constraints.
