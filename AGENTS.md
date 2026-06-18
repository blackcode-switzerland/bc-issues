# AGENTS.md

Guidance for any developer or AI agent working in this repo. The authoritative,
detailed instructions live in **`CLAUDE.md`** — read it. This file is the short,
load-bearing summary.

## What this project is

An AI-native, Linear-style issue tracker. It is consumed through **four surfaces
that must always stay in sync**:

1. **REST API** — `app/api/**` (Next.js App Router route handlers).
2. **OpenAPI spec** — `lib/openapi/spec.ts`, served at `GET /api/openapi.json`,
   rendered at `GET /api/docs`.
3. **`bk` CLI** — `cli/` (Go), published to npm as `@blackcode_sa/bc-issues`.
4. **Docs** — `docs/backend.md`, `docs/cli.md`, `docs/frontend.md`.

Plus `GET /api/meta` — the agent bootstrap endpoint (current user, active
workspace, and the enum vocabulary from `lib/work-items.ts`).

## The one rule that matters most

> **Any change to an API route or user-facing feature must be propagated to ALL
> four surfaces in the same change.**

Concretely, when you add / change / remove a route:

- Update the **route** in `app/api/**` (conventions: workspace-scoped under
  `/api/workspaces/{ws}/…`; `apiHandler` + `Errors`; lists via `jsonList()` →
  `{ data, next_cursor }`; create → 201; delete → `{ deleted: true }`).
- Update the **OpenAPI spec** `lib/openapi/spec.ts` (import enums from
  `lib/work-items.ts` — never hardcode them).
- Update the **CLI** command + client method in `cli/`.
- Update the relevant **doc** in `docs/`.

This is enforced: **`lib/openapi/parity.test.ts` (via `npm test`) fails the build
if the spec and the routes drift apart.**

## Before you finish an API/feature change

```bash
npx tsc --noEmit          # types
npm test                  # includes the OpenAPI↔routes parity test
cd cli && go build ./...  # CLI compiles
```

## Conventions cheat-sheet

- **Auth:** `Authorization: Bearer bk_live_…` (API token) or a browser session.
- **Errors:** `{ error, code, suggestion?, details? }` — always via `apiHandler`.
- **Lists:** `{ data, next_cursor }` (cursor pagination), built with `jsonList()`.
- **No legacy routes:** never reintroduce implicit-active-workspace endpoints;
  everything tenant-scoped goes under `/api/workspaces/{ws}/…`.
- **Enums (status/priority/health):** single source of truth is
  `lib/work-items.ts`; the spec and `/api/meta` both read from it.
- **Per-page agent note:** every page embeds a machine-readable access manifest
  (`lib/agent-manifest.ts` → `components/agent-manifest.tsx`, rendered in the root
  layout), and `/llms.txt` is generated from the same constant. If the auth
  header, envelope shapes, or discovery endpoints change, update
  `lib/agent-manifest.ts` — both surfaces update with it.
