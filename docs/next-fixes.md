# Next fixes — CLI friction log

Notes captured live on **2026-06-18** while using the `bk` CLI against **production**
to do something that should be trivial: *"fetch issue #234 in Andrea's workspace."*
It took ~10 steps and a fallback to raw `curl` to answer, because of the gaps below.

> **✅ All items resolved on 2026-06-18.** See per-item "Fixed" notes. The original
> task is now a one-liner: `bk issue list --ws 3 --search CRM` (or, once the API
> change is deployed, `bk issue view 234 --ws 3`). This file is kept as a record of
> what was wrong and how it was addressed.

## TL;DR of the struggle
The issue exists and is perfectly fine in the web UI (`#234`, the "CRM — Contacts
EPHJ" issue). But via the CLI I:
1. couldn't target Andrea's workspace without **mutating** my active workspace,
2. fetched it by the wrong number because `bk issue view` wants the **global id**, not the `#234` users see,
3. was led to a **wrong conclusion** ("all seqs are null") because the CLI **silently dropped the `seq` field**,
4. couldn't get the true count or search by number, and
5. ultimately had to bypass the CLI with `curl` + a bearer token to get the real data.

The data was correct the whole time. The CLI just couldn't surface or address it.

---

## Bugs (confirmed)

### 1. The CLI silently drops fields the API returns — including `seq` ✅ FIXED
- **Symptom:** `bk issue view 441 --json` and `bk issue list --json` never showed `seq`. I concluded "all 200 issues have null seq" — **false**. Raw API (`/api/workspaces/{ws}/issues/441`) returns `seq: 234` and `total: 234`.
- **Root cause:** the CLI re-marshals API responses through its own `Issue` struct (`cli/internal/client/types.go`), which had **no `Seq` field** (and was missing `labels`, `workspace_id`, `position`, `completed_at`, `cancelled_at`).
- **Fixed:** added `Seq`, `WorkspaceID`, `Position`, `CompletedAt`, `CancelledAt`, and `Labels` (with an `IssueLabel` type) to the Go `Issue` struct (`types.go`). `issue list` now shows the `#seq` in a `#` column **and** the global id in the `ID` column; `issue view` shows both plus labels. Verified live: `#234 / id 441`.

### 2. `bk issue view/edit/delete <id>` only accept the global id, not the displayed `#seq` ✅ FIXED
- **Symptom:** the UI shows `#234`; `bk issue view 234` → `404`. The real arg had to be `441` (global id).
- **Fixed:** every issue command now takes the **`seq`** by default (`bk issue view 234` or `#234`), resolving seq → global id server-side via a new `?seq=` filter on the list endpoint (`resolveIssueArg` + `GetIssueBySeq` in the CLI). Global id remains available as an escape hatch via the `id:441` prefix. Applies to view/edit/delete/assign/unassign/comment/comments/activity/attachments/attach/detach/watch/unwatch.
- **Note:** the seq→id resolution depends on the `?seq=` API change being **deployed** (see "Deploy needed" at the bottom).

### 3. Stale status values in `issue create --status` help ✅ FIXED
- **Symptom:** help text listed `backlog/todo/in_progress/blocked/in_review/done/cancelled`. `blocked` and `in_review` **don't exist** (real set: backlog/todo/in_progress/done/cancelled — `lib/work-items.ts`). The web create-modal had the same stale list.
- **Fixed:** corrected both `bk issue create --status` and `bk issue edit --status` help text, and aligned `components/create-issue-modal.tsx` to the canonical set (dropped `blocked`/`in_review`, added `cancelled`).

### 4. `issue list` `total` not surfaced ✅ FIXED
- **Symptom:** couldn't get the real issue count from the CLI; had to read `total` from raw API.
- **Fixed:** `issue list` now prints `showing X of N` (N = server-side total for the filter) to stderr, and includes `total` in JSON/YAML output. Verified live: `showing 5 of 234`.

---

## Ergonomics — "easy finding of issues"

### 5. No way to target another workspace without switching the active one ✅ FIXED
- **Symptom:** issue/task commands had **no `--ws` flag**, so reading one issue in Andrea's workspace meant `bk workspace use 3`, which **mutates** the active workspace (config + server-side). A read shouldn't have side effects.
- **Fixed:** added a global `--ws <slug|id>` persistent flag that overrides the workspace for that command only — no config write, no `POST /api/me/active-workspace`. Verified live: `bk issue list --ws 3` reads Andrea's workspace while the active stays `*1`.

### 6. Can't find an issue by number or text from the CLI ✅ FIXED
- **Symptom:** `bk issue list` filters were `--project/--status/--assignee/--mine` only. No `--search`, no by-number lookup.
- **Fixed:** added `--search` (server-side, hits the API's `?search=`) and by-seq lookup (`bk issue view 234` / `#234`, plus `?seq=`). Verified live: `bk issue list --ws 3 --search CRM` → exactly `#234`, `showing 1 of 1`.

### 7. Pagination is confusing / easy to under-fetch ✅ FIXED
- **Symptom:** `--limit 200` returned 200 with `next_cursor`, then the next page returned 0; with `seq`/`total` hidden it was impossible to tell if the full set was in hand.
- **Fixed:** `issue list` now shows `showing X of N` and `more available — use --cursor=… or --all`, and a new `--all` flag auto-paginates every page.

---

## Verbosity / diagnosability

### 8. No verbose/debug mode ✅ FIXED
- **Symptom:** when the CLI's view disagreed with reality, there was no way to see the actual request/response; I had to drop to `curl`.
- **Fixed:** added a global `-v/--verbose` flag (and `BK_DEBUG=1`) that logs each request's method, URL, response status, and body to stderr. Verified live.

### 9. The CLI couldn't answer the question at all — I bypassed it ✅ FIXED (meta)
- Resolved transitively by #1, #2, #5, #6. The original "fetch issue #234 in Andrea's workspace" is now `bk issue list --ws 3 --search CRM` (or `bk issue view 234 --ws 3` once deployed) — no `curl`, no config spelunking, no workspace mutation.

---

## Root cause behind most of it: dual identity (`seq` vs global `id`) ✅ DECIDED

Issues have two numbers: a per-workspace **`seq`** (what the web shows as `#234`) and a
global **`id`** (441).

**Decision taken:** the workspace-facing **`seq`** is now the identifier the CLI takes,
matching what humans see in the UI. The CLI resolves `seq` → `id` internally (via the
list endpoint's `?seq=` filter); the global id stays reachable through the `id:<n>`
prefix for scripts/back-compat. The OpenAPI `Issue` schema already documented `seq`, and
the `?seq=` query param was added to the spec, so REST/OpenAPI/CLI/docs stay in sync.

---

## Deploy needed

The seq→id resolution (#2) and by-seq search (#6) rely on the **`?seq=` filter** added to
`GET /api/workspaces/{ws}/issues` — a server change that takes effect on the next **web
deploy**. Until then, the CLI's `#seq` column, `--ws`, `--search`, `--all`, `total`, and
`--verbose` all work against the current production API; only the `bk issue view <seq>`
resolution path needs the deploy. A new CLI release is also needed to ship the binary
changes to users.
