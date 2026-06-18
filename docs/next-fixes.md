# Next fixes — CLI friction log

Notes captured live on **2026-06-18** while using the `bk` CLI against **production**
to do something that should be trivial: *"fetch issue #234 in Andrea's workspace."*
It took ~10 steps and a fallback to raw `curl` to answer, because of the gaps below.
Nothing here is fixed yet — this is the backlog. Severity is "how badly it blocks a
human or AI agent."

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

### 1. The CLI silently drops fields the API returns — including `seq` 🔴 high
- **Symptom:** `bk issue view 441 --json` and `bk issue list --json` never showed `seq`. I concluded "all 200 issues have null seq" — **false**. Raw API (`/api/workspaces/{ws}/issues/441`) returns `seq: 234` and `total: 234`.
- **Root cause:** the CLI re-marshals API responses through its own `Issue` struct (`cli/internal/client/types.go:51`), which has **no `Seq` field** (and is missing `labels`, `task_name`/`task_id` consistency, `completed_at`, `position`, `workspace_id`, etc.). Anything not in the struct is dropped from `--json`/`--yaml` output too.
- **Impact:** the CLI shows the *wrong/absent* issue number, hides data agents need, and actively misleads debugging. This single gap caused most of the wasted time.
- **Fix:** add the missing fields to `Issue` (at minimum `Seq *int`), and surface `#seq` in table output. Audit every client struct for parity with the API (consider generating from the OpenAPI spec).

### 2. `bk issue view/edit/delete <id>` only accept the **global id**, not the displayed `#seq` 🔴 high
- **Symptom:** the UI shows `#234`; `bk issue view 234` → `404`. The real arg had to be `441` (global id).
- **Root cause:** `cli/internal/commands/issue.go:207` does `strconv.Atoi(args[0])` → `client.GetIssue(id)` → `GET /api/workspaces/{ws}/issues/{id}` resolves by **global id**. Same pattern for edit/assign/comment/delete (lines ~346, 430, 458, 514, 545).
- **Impact:** a human or agent reading `#234` anywhere (UI, another person, a report) has **no way** to act on it from the CLI. They must already know the hidden global id.
- **Fix:** make these commands accept the **`seq`** (the workspace-facing number) — resolve seq→id server-side or via a lookup — and ideally accept a leading `#`. The number users see should be the number the CLI takes.

### 3. Stale status values in `issue create --status` help 🟡 medium
- **Symptom:** `cli/internal/commands/issue.go:326` help text lists `backlog/todo/in_progress/blocked/in_review/done/cancelled`. `blocked` and `in_review` **don't exist** (real set: backlog/todo/in_progress/done/cancelled — `lib/work-items.ts`). The web create-modal has the same stale list (`components/create-issue-modal.tsx`).
- **Impact:** agents pass invalid statuses based on the help.
- **Fix:** source the allowed values from a single place; drop `blocked`/`in_review`.

### 4. `issue list` `total` not surfaced 🟡 medium
- **Symptom:** couldn't get the real issue count from the CLI; had to read `total` from raw API. (`IssuesPage` in types.go *has* a `Total` field, but the list command output didn't expose it.)
- **Impact:** scripts/agents can't see "X of N"; encourages the truncation bug class we already hit in the web listing.
- **Fix:** print `total` (and `next_cursor`) in list output, table and JSON.

---

## Ergonomics — "easy finding of issues"

### 5. No way to target another workspace without switching the active one 🔴 high
- **Symptom:** issue/task commands have **no `--ws` flag**, so to read one issue in Andrea's workspace I ran `bk workspace use 3`, which **mutates** my active workspace (config **and** server-side `POST /api/me/active-workspace`). A read shouldn't have side effects.
- **Fix:** add a global/`issue`-level `--ws <slug|id>` that overrides the active workspace for that command only (analytics already supports `--ws`; make it consistent everywhere).

### 6. Can't find an issue by number or text from the CLI 🔴 high
- **Symptom:** `bk issue list` filters are `--project/--status/--assignee/--mine` only (`issue.go:64-68`). No `--search` (text), no `--seq`/by-number lookup. To find `#234` I had to page and grep client-side — which then failed because `seq` wasn't even in the output (bug #1).
- **Fix:** add `--search` (server-side, the API already supports `?search=`), and a direct `bk issue view #<seq>` / `--seq` path. A `bk issue find` that matches title/number would help agents a lot.

### 7. Pagination is confusing / easy to under-fetch 🟡 medium
- **Symptom:** `bk issue list --limit 200` returned 200 with `next_cursor`, then the next page returned 0; with `seq`/`total` hidden it was impossible to tell if I had the full set. (Mirrors the web listing truncation bug we fixed.)
- **Fix:** surface `total` + a clear "showing X of N — use --cursor=… for more" line; consider an `--all`/auto-paginate flag for commands that need the full set.

---

## Verbosity / diagnosability

### 8. No verbose/debug mode 🟡 medium
- **Symptom:** when the CLI's view of the data disagreed with reality, there was no way to see the actual request/response. I had to drop to `curl` with the bearer token to diagnose.
- **Fix:** a `-v/--verbose` (or `BK_DEBUG=1`) that logs the request URL, status, and raw response body to stderr.

### 9. The CLI couldn't answer the question at all — I bypassed it 🔴 high (meta)
- The end state of "fetch issue #234" was: give up on `bk`, read the token out of `~/.config/bk/config.json`, and `curl` the API. If the maintainer has to bypass the CLI to read an issue by its visible number, agents/users will too. Bugs #1, #2, #5, #6 together cause this.

---

## Root cause behind most of it: dual identity (`seq` vs global `id`)

Issues have two numbers: a per-workspace **`seq`** (what the web shows as `#234`) and a
global **`id`** (441). The surfaces disagree about which is "the" identifier:
- **Web UI** → shows `seq`.
- **API routes** → address by global `id` (`/issues/{id}`).
- **CLI** → takes global `id`, and doesn't even return `seq`.

This mismatch is the source of nearly every struggle above. **Decision needed:** pick the
workspace-facing `seq` as the identifier humans/CLI use (resolve to `id` internally), and
make the CLI/API/`/api/meta` consistent about it. Until then, "issue 234" means different
things on different surfaces.

---

## Suggested priority order
1. **#1** add `seq` (+ missing fields) to the CLI `Issue` struct — stops the CLI from lying.
2. **#2 / #6** accept `#seq` in `bk issue view`/etc. + add `--search` — make issues findable by what users see.
3. **#5** `--ws` on issue/task commands — read across workspaces without side effects.
4. **#4 / #7** surface `total` + pagination clarity.
5. **#8** `--verbose`. **#3** fix stale status help.
6. Resolve the **seq-vs-id identity** decision so the surfaces stop disagreeing.

> Most of these also feed the paused "edge cases & API/CLI verbosity" research — fold them
> in when that resumes.
