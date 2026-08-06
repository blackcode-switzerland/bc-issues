# Migration health check — 2026-08-06

The closing evidence for the nine-phase platform migration that shipped
2026-08-05. This is the last file in `docs/migration/`.

**Verdict: the migration landed cleanly.** Every structural, data and boundary
check passes, and every number in the wrap-up brief reproduced exactly. Five
findings are recorded below. **None of them breaks the product**; all five are
documentation or guardrail defects, and two of them are the same class of
green-but-inert check the migration was defined by. Nothing was fixed — this
document reports, per the plan.

Two checks could not be completed by an agent and are owed: the browser
click-through (§1.1) and the app-role boundary probe (§1.3). Both are named at
the bottom with what they need.

---

## Method

The standard this migration set applies to its own verification:

> **A check is inert until you have watched it fail.**

So every guardrail claimed below was broken on purpose, watched go red, and
restored — and where a check returned "nothing found", its *inputs* were
asserted separately, because a guard that found nothing to check otherwise
passes. Two of the five findings were produced by exactly that discipline and by
nothing else: reading the code would not have surfaced either.

Two measurement errors of my own are worth recording, since both initially
looked like product defects and neither was:

- `bk issue list` appeared to lose its deprecation hint. It had not — `head -5`
  truncated stdout before the `hint:` line, because cobra's "Did you mean" block
  pushes it down three lines.
- `platform.entities` appeared to over-project issues 670 vs 435. It does not —
  the projection deliberately includes soft-deleted rows, since a trashed item is
  still addressable by URN and restorable. `deleted_at IS NULL` was my filter,
  not the system's.

Both are noted because "verification found something" is expensive, and a report
that hides its own false starts is not evidence of care.

---

## 1.2 The product still works for agents

Run with the **published** binary — `@blackcode_sa/bc-issues@1.12.0` installed
from npm, `bk version` reporting commit `3098604`, which is the release commit —
against production. Not a local build.

| Check | Result |
|---|---|
| `bk guide`, `bk meta`, `bk changelog` | pass — all three entry points answer |
| `bk issues issue create\|list\|view\|edit` | pass |
| `bk issues task …`, `bk issues project …` | pass |
| `bk workspace list`, `bk workspace use` | pass — 4 workspaces, unchanged |
| `bk upload` | pass — landed at `issues/blackcode-issues/…`, the Phase 7 app prefix |
| `bk storage list`, `bk storage rm` | pass |
| `bk trash list\|restore\|purge` | pass — REF column shows `issue:17`, the #number |
| `bk search`, `bk link`, `bk activity` | pass — federated search and URN linking both work |
| `bk super-admin entity-drift` | **no drift** — 670/670 issue, 69/69 task, 71/71 project |
| `bk super-admin blob-drift` | **no drift** — issues 71/71, platform 38/38 |
| `bk skill sync` | pass |
| removed spellings | pass — `bk issue\|task\|project\|undo` all exit **2** and name their replacement |
| exit codes | pass — 404 → **5**, with a recovery hint |

**The round trip is the strongest single result here.** A full
create → edit → comment → upload → link → delete → restore → delete → purge cycle
was run against production, and afterwards both reconcilers returned to *exactly*
their starting counts (670/69/71 and 71/38). The entity projection and the
trigger-maintained blob index both survived a live write cycle with zero drift.
All verification artifacts were purged; the three pre-existing trash items were
verified untouched.

Two behaviours specifically required by `CLAUDE.md` were confirmed by observation
rather than assumed:

- **`bk trash purge` reports what it destroyed, not how many.** Output was
  `destroyed issue:17  wrap-up verification — renamed`, with the title captured
  before the delete.
- **The 1.12.0 restore fix genuinely fires.** `bk trash restore issue:999999`
  exits 5 with `no such item in this workspace` — it does not report success for
  a ref that does not exist, which was the bug fixed in 1.12.0.

### The retired routes still answer correctly

| Route | Status | Body |
|---|---|---|
| `/api/undo` | **410** | JSON, `code: surface_retired`, carries a `suggestion` |
| `/api/openapi.json` | **410** | JSON, carries a `suggestion` |
| `/api/docs` | **410** | JSON, carries a `suggestion` |
| `/api/status` | 200 | `overall: ok`; db 9ms, blob 121ms |
| `/api/changelog` | 200 | `cli_min_version: 1.9.1` |

All three retirements return JSON with an actionable `suggestion`, not HTML and
not a 404 — an agent on stale context can recover inside the same run.

---

## 1.3 The separation is real, not cosmetic

### The build

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 |
| `cd cli && go build ./... && go vet ./... && go test ./...` | exit 0 |
| `cd cli && make routes` | clean, no diff |
| `apps/_template` | builds; own tests 6/6 pass |

### The guardrails, broken on purpose

| Guardrail | Broken with | Result |
|---|---|---|
| Parity test | added `GET /api/workspaces/{ws}/breakme` with no `bk` command | **RED** — named the uncovered route |
| Cross-app import (vitest) | `import '../../issues/lib/work-items'` in `_template` | **RED** |
| Cross-schema query (vitest) | `select … from issues.issues` in `_template` | **RED** — quoted the offending line |
| Guide cross-app test | `bk issues …` inside `topics/template/` | **RED** |
| Blob drift `missing` | dropped one row from the index snapshot | **RED** — reported the exact url |
| Blob drift `orphaned` | inserted an index row with no source | **RED** — this is finding #3's fix, and it works |
| **Cross-app import (ESLint)** | same import as above | **GREEN — see Finding 5** |
| Platform-package → app (ESLint) | `import '../../../apps/issues/…'` in `platform-storage` | **RED** — finding #1's fix works |

All probes were removed and every guardrail re-verified green afterwards; the Go
re-run was forced with `-count=1`, because a cached `ok` is not evidence. The
working tree is clean.

### The database boundary

Confirmed from the owner side against `main`:

- `issues_app` is **not** superuser, has no `CREATEDB`, no `CREATEROLE`, and
  **owns 0 objects**.
- `issues_app` had **5 live connections** at the time of checking — production is
  genuinely serving as that bounded role, not as the owner.

---

## 1.4 Database health

Every value below was checked against `main` and matched the expected figure
exactly — 13 of 13.

| Check | Expected | Actual |
|---|---|---|
| migrations applied | 41 | **41** |
| `issues.workspace_counters` rows | 17 | **17** |
| `platform.workspace_counters` exists | false | **false** |
| `platform.apps` rows | 1 | **1** |
| `platform.events.app` NOT NULL | true | **true** |
| `platform.uploads.app` NOT NULL | true | **true** |
| `platform.blob_references` rows | 109 | **109** |
| blob-reference triggers | 6 | **6** |
| workspaces | 17 | **17** |
| users | 15 | **15** |
| `platform.entities` total | 810 | **810** |
| objects owned by `issues_app` | 0 | **0** |
| members without `app_access` | 0 | **0** |

Entity projection, per type — including soft-deleted rows, which is correct:

| Type | Source | Projected |
|---|---|---|
| issue | 670 | 670 |
| task | 69 | 69 |
| project | 71 | 71 |

### `blob-drift-check.sql`

Run on a **disposable branch forked from `main`** (`wrapup-blob-drift-rehearsal`,
`br-spring-snow-as8s7s1w`) rather than against production. The script needs one
transaction ending in `ROLLBACK`; the available SQL tooling could not guarantee
that rollback, and running six unqualified `UPDATE`s against production in
autocommit to satisfy a read-only check is not a trade worth making. A branch is
a byte-identical copy, so the result is equivalent — and the script's own header
names a rehearsal branch as the polite choice.

- **Result: zero rows.** No `missing`, no `stale_extra`, no `orphaned`.
- **`unreconcilable_rows = 0`** (this half is pure `SELECT` and was run directly
  against `main`).
- **Inputs asserted**, because an empty result and a check that never ran are
  indistinguishable: the re-fire touched **806 content rows** across all six
  surfaces — issues 419, comments 321, attachments 24, projects 21, tasks 20,
  project_updates 1 — and the index held 109 rows before and 109 after.

---

## 1.5 No user was disturbed

- **Workspace visibility is an exact bijection, across all 15 users** — not a
  sample. 42 memberships, 42 reachable via the real `accessibleWorkspaceIds`
  join (`app_access` × `workspace_apps` × `apps.enabled`). **0 lost, 0 gained.**
- **Nobody was signed out.** The cookie-domain change is still deferred, and
  structurally so: production sets `__Host-next-auth.csrf-token`, and the
  `__Host-` prefix **cannot carry a `Domain` attribute by specification**.
  `callback-url` is `https://issues.blackcode.ch`, so `NEXTAUTH_URL` is unchanged.
- **`cli_min_version` is `1.9.1`** — nobody is locked out.
- **Pre-migration content is intact.** The three oldest blobs at the store root
  (pre-Phase-7, unprefixed) still resolve — two PDFs and a PNG, correct
  content-types. 104 files sit at the root and 1 is app-prefixed; **all 105
  upload rows are attributed `app = 'issues'`, zero NULL.** Oldest issue and
  comment both date to 2026-06-15 with content intact.

> **Worth carrying forward:** the `__Host-` prefix is a hard constraint on the
> deferred cookie-domain change. Moving the session cookie to `.blackcode.ch`
> requires **dropping the `__Host-` prefix**, because the two are mutually
> exclusive. That is a rename of the cookie, which signs everyone out — the
> deferral is not just "flip a domain". This belongs in whatever schedules that
> window.

---

## Findings

None of these breaks the product. Three are stale strings shipped inside the
1.12.0 binary; two are guardrails that report success while checking less than
they claim.

> **All five were fixed on 2026-08-06**, after being reported. The fixes are
> recorded under each finding and in `docs/changelog/platform.md`. The three
> string fixes are **in the source, not in the published binary** — 1.12.0 as
> installed still carries them, and they correct themselves on the next CLI
> release. No release was cut for this: none of the three changes behaviour, and
> `CLI_MIN_VERSION` stays at 1.9.1 by decision.

### 1. `bk issues --help` still advertises `bk undo`

`cli/internal/commands/issues/issues.go:37` — "Workspaces, labels, files,
members, invitations, trash **and undo** are PLATFORM verbs". `bk undo` was
removed in 1.12.0, and this is the shipped help text.

### 2. `bk issues --help` claims the removed aliases still work — the worst of the three

`cli/internal/commands/issues/issues.go:41` — "Every command below also answers to
its old un-namespaced spelling (`bk issue list`), **which still works** and
prints one deprecation line."

That was true in 1.10.x and 1.11.x. It is false in 1.12.0: commit `6c0f562`
pruned the aliases on schedule, and `bk issue list` now exits 2. This is the most
consequential of the three, because an agent reading `bk issues --help` is told
in plain terms that a spelling works when it does not — and the help text is a
more likely stop than the changelog.

The deprecation *hints* are correct and do fire; it is only this paragraph that
is stale.

### 3. `bk meta` announces a removal that did not happen

`cli/internal/commands/platform/meta.go:118` prints "(the top-level
vocabulary/limits/media keys are deprecated and **go away in 1.12.0**)". The
running binary *is* 1.12.0, and `/api/meta` still serves all three top-level keys.

Keeping them is almost certainly right — `cli_min_version` is 1.9.1, so binaries
that read the top-level keys are still supported. The defect is the announcement,
which now contradicts both the version it names and the server.

### 4. The guide's dynamic-value guard covers less than `CLAUDE.md` claims

`CLAUDE.md` states `guide_test.go` "fails the build if a topic hardcodes" a
dynamic value. What `TestTopicsDoNotHardcodeDynamicValues` actually does is
substring-match **six hand-written strings**: `100MB`, `100 MB`, `on_track`,
`at_risk`, `off_track`, `image/svg+xml`.

Watched not-fail. A topic containing all of the following passed on every section:

- the entire issue status vocabulary — `backlog, todo, in_progress, done, cancelled`
- the entire priority vocabulary — `1 urgent, 2 high, 3 medium, 4 low, 5 none`
- a **stale** upload limit — `50 MB`

The last is the sharpest edge: the guard bans the *correct* spelling of the limit
(`100MB`) but not a wrong one, so a topic that quietly goes out of date is
exactly the case it cannot catch. The two issue vocabularies are the values a
guide topic is most likely to restate, and they are uncovered.

The guard is not useless — it does catch `project_update_health` and the blocked
MIME type. It is narrower than its documentation, which is how a check gets
trusted past its range.

**Fixed.** Size limits are now matched by **shape** (`\b\d+\s?[MG]B\b`), so a
stale number is caught as readily as the correct one, and vocabulary
enumerations are counted per line. Two things are worth recording about the fix,
because both were themselves caught by watching it fail:

- The first version **failed the real topics**, and both hits were legitimate —
  `--status in_progress` inside a worked example, and a passage listing the
  CLI's accepted input words that already ended "Do not hardcode either —
  `bk meta` is authoritative." A guard that fails correct writing gets weakened
  or deleted. It now distinguishes *enumerating* a vocabulary from *illustrating*
  a command.
- The escape hatch was topic-wide for one draft ("does this topic mention
  `bk meta`?"), which made the branch **inert again**: every topic worth writing
  mentions `bk meta` somewhere, so a bare enumeration anywhere else got a free
  pass. Caught by injecting the enumeration and watching it stay green. The
  window is now the line plus its neighbours.

All three branches were then watched fail individually, with a control
confirming a correctly-written enumeration still passes.

### 5. The `apps/<a>` → `apps/<b>` ESLint rule is still inert

This is **finding #4 from the closing summary, still present**. The rule in
`apps/_template/.eslintrc.json` (and `apps/issues/.eslintrc.json`) carries the
same three globs the migration identified as non-functional:

```
"**/apps/*/**", "../../apps/*", "../../apps/*/**"
```

Watched not-fire. `import { WORK_ITEM_STATUSES } from '../../issues/lib/work-items'`
in `apps/_template/lib/` — the real shape of an escape, where the climb has no
fixed depth and the segment `apps` never appears in the specifier — **lints
clean, exit 0.**

Input asserted: ESLint *is* processing that file. The same run with
`--rule '{"no-var":"error"}'` flagged a `var` on the next line, so the file is
linted and `no-restricted-imports` simply does not match.

**The boundary itself is safe.** The resolution-based
`lib/app-isolation.test.ts` catches this import — verified red, above — and that
test is what replaced the rule. The problem is that the dead rule was left in
place next to its working replacement, carrying a detailed message about
`PLATFORM-ARCHITECTURE.md §7.6`. It reads as protection. By this repo's own
standard it should be repaired or removed, not left as scenery.

The opposite direction is fine: `packages/platform-*` → `apps/*` **does** fire,
confirmed on `platform-storage`, the package that can reach `del()`.

**Fixed by deletion.** The rule is gone from both `apps/*/.eslintrc.json`. A glob
over import strings cannot express "resolves into a sibling app" — that is the
whole reason the resolution-based test exists — so there was no version worth
keeping, and keeping a narrowed one would have re-created the same false comfort.
The boundary was re-verified red *after* the removal, in the other direction
(`apps/issues` importing `apps/_template`), to confirm the test is carrying it
alone. Both `app-isolation.test.ts` headers now say the rule was deleted and why,
because that file is where someone would think to re-add it — and `_template`'s
copy propagates to every future app.

---

## Not done — owed, with what they need

### §1.1 The browser click-through — **owed, needs a human**

Fifteen checks on `issues.blackcode.ch` signed in as a real account: login by
password *and* Google OAuth, workspace switcher, create/rename an issue, create a
task and project, `@mention`, drag-drop image, non-image attachment, editor table
round-trip, labels, move/copy across workspaces, the trash cycle, analytics,
`/status`, and an invite.

An agent cannot log into the web UI. **The plan gates on this** — it is not
covered by §1.2, and the migration's own history is the argument: `/api/status`
was green throughout the Phase 7 outage.

### §1.3 `app-boundary-probe.sql` — **owed, needs the production credential**

The probe must run in a session **authenticated as `issues_app`**. `SET ROLE` is
not a substitute and gives the wrong answer by design; the local `.env.local`
points at a docker Postgres as role `blackcode`, and there is no `psql` on this
machine. The production `DATABASE_URL` lives in Vercel.

```bash
psql "<issues_app connection string>" -f docs/sql/app-boundary-probe.sql
```

Expected: every line `ok`, every deny `42501`. Check **(2)** will report
`SKIPPED — no other app schema exists yet`, which is correct with one app and is
the loud skip the script was rewritten to produce. Everything the probe covers
that *is* observable from the owner side — `issues_app` owns zero objects, is
unprivileged, and is the role production actually connects as — is confirmed above.

### Housekeeping

`wrapup-blob-drift-rehearsal` (`br-spring-snow-as8s7s1w`) was created for the
drift check and **still exists**. It has fault-injection rows in it and must be
deleted. It is not one of the eight branches in the wrap-up plan's §3.3 table.
