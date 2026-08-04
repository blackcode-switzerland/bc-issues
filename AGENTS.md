# AGENTS.md

Guidance for any developer or AI agent working in this repo. The authoritative,
detailed instructions live in **`CLAUDE.md`** — read it. This file is the short,
load-bearing summary.

## What this project is

A **monorepo** (npm workspaces + Turborepo) of Blackcode's internal apps. Today
there is exactly one — **`apps/issues`**, an AI-native, Linear-style issue
tracker. Humans use the web UI; **agents use one interface: the `bk` CLI**
(`cli/`, at the repo root, Go, published to npm as `@blackcode_sa/bc-issues`).

Run every command from the **repo root**; Turborepo delegates into the workspace.
`PLATFORM-ARCHITECTURE.md` is where this is going and `PLATFORM-MIGRATION-PLAN.md`
is how. **Phases 0–5 have landed:** `packages/platform-{db,api,ui,auth}` exist,
the database is `platform.*` + `issues.*` (not `public`), apps are real data —
workspace listings are app-scoped and every workspace-scoped route enforces per-app
access — and **the CLI, guide, changelog, `bk meta` and docs are all split per app.**

Commands are `bk issues issue create`, not `bk issue create`. Every old spelling
still runs as a deprecated alias that prints one stderr line naming the new one;
they go away in 1.12.0. Platform verbs (`workspace`, `label`, `upload`, `trash`,
`invite`, …) stay bare — they mean the same thing in every app.

The HTTP API under `apps/issues/app/api/**` is **private plumbing with no public contract**.
Do not document it for external consumers, and never reintroduce an OpenAPI spec
or a fat page manifest — both were deleted on 2026-08-03 precisely because they
were hand-maintained copies of facts that lived elsewhere, and they drifted.

Two sources of truth, and only two:

| Kind of knowledge | Where | Why there |
|---|---|---|
| **Static** — how the tool behaves (flags, exit codes, workflows) | `cli/internal/guide/topics/{platform,<app>}/*.md`, `//go:embed`-ed, served by `bk guide` | It describes *the binary being run*. Fetching it from the server could describe a `--flag` the agent doesn't have. |
| **Dynamic** — what the data is now (vocabularies, limits, workspaces) | the server, via `GET /api/meta` → `bk meta` | Changes without a CLI release. |

A guide topic must **never** restate a dynamic value. Point at `bk meta` instead.

## The one rule that matters most

> **Every change lands in three places, in the same commit:**
> **route → `bk` command → changelog entry.**
>
> Plus a conditional fourth: a guide topic, *only* if agent-visible behaviour
> changed. If only a value changed (a limit, an enum), edit its source — `bk meta`
> serves it live and no guide edit is needed.
>
> Corollary: **every API route must be reachable from `bk`.** A route with no
> command is a capability an agent cannot use.

Detail:

1. **Route** — `apps/issues/app/api/**`. Same conventions: workspace-scoped under
   `/api/workspaces/{ws}/…`; auth + errors via `apiHandler` + `Errors`; lists via
   `jsonList()` → `{ data, next_cursor }`; create → 201; delete →
   `{ deleted: true }`.
2. **CLI** — add or update the `bk` command + client method in `cli/`, **and its
   `routes` annotation** (`Annotations: map[string]string{"routes": "GET /api/…"}`,
   or `"none"` when the command makes no HTTP call). App nouns go in
   `cli/internal/commands/<app>/`, shared verbs in `commands/platform/`; the two
   must not import each other (`boundaries_test.go` enforces it).
3. **Changelog** — one dated entry at the top of the right `docs/changelog/*.md`:
   `platform.md` for anything shared, `<app>.md` for one app's own surface.

Conditional, only when it applies:

- **Guide** — agent-visible *behaviour* changed → update the relevant
  `cli/internal/guide/topics/platform/*.md` or `topics/<app>/*.md`. A topic under
  `topics/<app>/` may not describe another app.
- **`bk meta`** — a vocabulary or limit changed → update its source
  (`apps/issues/lib/work-items.ts`, `apps/issues/lib/limits.ts`, `apps/issues/lib/upload.ts`); `/api/meta` and
  `bk meta` follow automatically via `apps/issues/lib/agent-meta.ts`. Never restate a value
  in a guide topic.
- **Deprecations** — renamed or removed a flag/command → add a row to
  `cli/internal/commands/deprecations.go` in the same commit.

This is enforced. **`apps/issues/lib/cli-parity.test.ts` (via `npm test`) fails the build**
if a route has no CLI coverage, or if the CLI claims a route that doesn't exist.
**`cli/internal/commands/routes_test.go`** fails if a leaf command declares
nothing at all.

## Writing commands agents can survive

- **`Confirm()` is not a guard for agents** — it auto-approves under
  `BK_NO_PROMPT=1` and on a non-TTY, which is how agents run. For anything
  irreversible, make the caller repeat the target back (`--confirm <slug>`), and
  require it even with `--yes`. Never default a destructive command to the active
  workspace.
- **Every failure exits non-zero with one line on stderr.** Exit codes are the
  contract; stdout stays parseable. Cobra's defaults fight this and are corrected
  in `root.go` (`SilenceErrors`, `rejectUnknownSubcommands`).
- **A dead end must name its own exit** — via the server's `suggestion`, a
  `deprecations.go` row, or the generic `bk skill sync`. See `hintFor()` in
  `cmd/bk/main.go`.

## Before you finish an API/feature change

Run these **from the repo root**:

```bash
npm run typecheck                                         # types (NOT `npx tsc --noEmit`)
npm test                                                  # includes apps/issues/lib/cli-parity.test.ts
npm run build                                             # pure build; touches no database
cd cli && go build ./... && go vet ./... && go test ./...  # CLI + guide/skill/groups tests
cd cli && make routes                                     # if a `routes` annotation changed
```

`npx tsc --noEmit` has no root `tsconfig.json` to find in the monorepo — that is
deliberate, since a root config compiling nothing would report a vacuous green.

## Conventions cheat-sheet

- **Auth:** `bk login` (or a browser session for the web UI).
- **Errors:** `{ error, code, suggestion?, details? }` — always via `apiHandler`.
  Set `suggestion` on any 400/404/409 an agent can realistically hit; the CLI
  prints it as a `hint:` line, which is what turns a dead run into a recovered one.
- **Lists:** `{ data, next_cursor }`, built with `jsonList()`.
- **No legacy routes:** everything tenant-scoped goes under `/api/workspaces/{ws}/…`.
- **Enums:** single source of truth is `apps/issues/lib/work-items.ts`; `/api/meta` serves
  them under `apps.issues.vocabulary` (the top-level `vocabulary` key is deprecated
  and goes away in 1.12.0).
- **Limits:** single source of truth is `apps/issues/lib/limits.ts`; the route that enforces a
  cap imports it, and `/api/meta` serves it. Never re-type a number.
- **Docs live in two places:** `/docs` is the platform, `/apps/<app>/docs` is that
  app. Root docs never describe an app's internals; app docs never describe
  another app.
- **Per-page agent note:** `apps/issues/lib/agent-manifest.ts` → `apps/issues/components/agent-manifest.tsx`
  (root layout) and `/llms.txt`. It is a **pointer, not a copy** — keep it under
  ~10 lines and add nothing that could ever become false.
