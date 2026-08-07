# Next fixes — CLI friction log

> **Historical record, kept as written.** It mentions keeping "REST/OpenAPI/CLI/docs
> in sync" — that was true in June 2026. The OpenAPI spec was retired on
> 2026-08-03 and the contract is now three edits: route → `bk` command → changelog.
> See `CLAUDE.md`. Nothing below should be copied as current practice.

---

## OPEN FOLLOW-UPS

Dated items still owed. Everything under the horizontal rule below this section
is the closed 2026-06-18 record and is history — read it, do not act on it.

### 2026-08-07 — GUARDRAIL #10: `npm test` replayed a cached green over a failing suite

**For `CLAUDE.md`'s table of green-but-inert guardrails — agent9 adds the row at
Phase 13. Recorded here so it is not lost in between. The cause is FIXED
(`turbo.json`); the entry stays because the table is the memory.**

Turbo's `inputs` globs are resolved **relative to the package**, and the `test`
task declared only `**/*.ts`, `**/*.tsx` and `cli/`. The two tests in
`packages/platform-testing/test/` scan `apps/**` and `packages/platform-*/src/**`
— neither of which was in the key, and neither of which reaches it through a
dependency edge. So the cache could not see the files those tests exist to read.

Observed on 2026-08-07, same commit, same minute:

```
$ npm test --workspace=@blackcode/platform-testing     1 failed | 15 passed
$ npx turbo run test --filter=@blackcode/platform-testing
                                                       1 successful, 1 cached
                                                       >>> FULL TURBO
```

It is worse than the nine before it. An inert check fails to *catch* something;
this one **actively reported a pass over a failing suite**, to four agents in a
row who had each been told to prove their guards fire. And of everything it could
have hidden, it hid the two tests `docs/adding-an-app.md` promises a new app
inherits *"with nothing to register"* — `package-isolation` and the D-30
`@source` guard. The guarantee and the thing making it untrue shipped in the same
week.

Two corollaries worth keeping:

- **A cache is part of a check.** A guard is only as honest as the key that
  decides whether to run it, and nothing in this repo had ever reviewed one.
- **Deleting `inputs` would not have fixed it.** The fallback is the package's
  own files — the same package-scoped blindness with fewer words, and it would
  have dropped `cli/` from `apps/issues`' parity key as well.

### 2026-08-06 — purging an issue orphans its comments, and that leaks blobs

Found while app-qualifying `comments.parent_type` (Phase 1e). Unrelated to that
change, and **not fixed** — it needs a design decision on a destructive path.

`purgeOne` in `apps/issues/lib/db/queries/deletion.ts` hard-deletes the
issue/task/project row. Nothing deletes its `platform.comments` rows. The FK that
used to cascade them was `comments.issue_id`, **dropped in migration 0032**
because a platform→app foreign key would have broken `pg_dump --schema=issues`
as an extraction path. The file's own header still described that cascade until
today; the header is corrected, the behaviour is not.

**The row count is not the problem.** `platform.blob_references` is
trigger-maintained on `platform.comments`, so an orphaned comment keeps its
reference rows alive, and the delete gate refuses to delete a file anything still
references. A file embedded only in a comment on a purged issue is therefore
**permanently undeletable** — an unbounded, silent leak in the subsystem
`CLAUDE.md` names as the thing standing between a code change and unrecoverable
data loss.

It fails **closed**, which is the safe direction, and that is exactly why it will
never surface on its own. `bk super-admin blob-drift` will not report it either:
the reference is real, the comment row genuinely exists, and nothing is missing
from the index. Only the *parent* is gone.

Whoever takes it decides between:

- **cascade on purge** — delete the comments in `purgeOne`'s transaction, which
  fires the triggers and frees the references correctly. Simplest, and it makes
  `collectPurgeUrls` (which already reads those comments for blob sweeping,
  moments before they become unreachable) coherent again.
- **a reconciler** — find comments whose `parent_type`/`parent_id` resolve to
  nothing, and decide separately what to do with the blob references they free.
  A file freed this way may still be referenced elsewhere; the gate must decide,
  not the reconciler.

Do **not** reach for a platform→app FK. 0032 removed the last one on purpose.

### 2026-08-06 — CONTRACT: drop the bare legacy values from the two type CHECKs

Migrations `0041`/`0042` app-qualified `platform.comments.parent_type` and
`platform.deletion_batches.root_type` to `<app>:<noun>` and backfilled every
existing row. That was **expand + migrate**. The **contract** step is still owed:

1. Drop `IN ('issue','task','project')` from both CHECK constraints, leaving only
   the shape pattern.
2. Delete the legacy branch of `typeMatchForms` in
   `packages/platform-db/src/qualified-type.ts`, and with it `ownTypeForms` /
   `ownTypeIn` in `apps/issues/lib/db/queries/qualified-type.ts` — the reads then
   match one value instead of two.

**The precondition is a CODE fact, not a data fact.** `SELECT … WHERE
parent_type IN ('issue','task','project')` returning zero rows proves nothing: it
proves nothing has written the bare form *lately*, not that nothing *can*.
Verify instead that no deployed build reaches an unqualified write — every write
goes through `ownType()`, so the check is that `ownType` is the only value passed
to `parent_type` / `root_type`, in every app, at the version each is running.

Earliest safe release: the one after `0041`/`0042` reach production in every
deployment. **Nothing fails if this is forgotten** — both columns keep working
with a wider constraint than they need — which is exactly why it is written down.

### 2026-08-06 — drop the `bk 2.x` parenthetical from the trash suggestions

CLI 3.0.0 moved the recycle bin behind the app name (`bk <app> trash list`,
D-11). Four server `suggestion` strings print to an agent as `hint:` lines and
now name **both** spellings, new one first:

    run `bk <app> trash list` (`bk trash list` on bk 2.x) …

- `app/api/workspaces/[ws]/trash/parse.ts`
- `app/api/workspaces/[ws]/trash/restore/route.ts`
- `app/api/workspaces/[ws]/trash/resolve.ts`
- `app/api/undo/route.ts` (both the `suggestion` and the `replaces` map)

The parenthetical is there because a pre-3.0.0 binary cannot run the new
spelling, and `/api/undo` in particular is a 410 stub whose entire audience is
old clients.

**When `CLI_MIN_VERSION` (`packages/platform-agent/src/cli-version.ts`) passes
3.0.0, delete the parenthetical from all four.** No supported client can run the
old spelling by then, and a hint that teaches a dead one is exactly the failure
these strings exist to prevent. There is no other trigger for this — nothing
fails if it is forgotten, which is why it is written down.

---

Notes captured live on **2026-06-18** while using the `bk` CLI against **production**
to do something that should be trivial: *"fetch issue #234 in Andrea's workspace."*
It took ~10 steps and a fallback to raw `curl` to answer, because of the gaps below.

> **✅ All items resolved on 2026-06-18.** See per-item "Fixed" notes. The original
> task is now a one-liner: `bk issue list --ws 3 --search CRM` (or, once the API
> change is deployed, `bk issue view 234 --ws 3`). This file is kept as a record of
> what was wrong and how it was addressed.
>
> **⚠️ Superseded (2026-06-22).** Some mechanisms named below — the `?seq=` list
> filter, `GetIssueBySeq`, and the `id:<globalid>` / `id:441` escape hatch — were
> removed by the single-id refactor. Items are now addressed only by their
> workspace `#number` (which *is* the `id`); there is no global id. This file is
> historical; for current behavior see `docs/api-changelog.md`.

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
