# Changelog — platform

Breaking and notable changes to the **platform**: identity, workspaces,
membership, per-app access, labels, uploads, tokens, the inbox, trash, undo — and
the `bk` CLI itself. Newest first.

Each app has its own file beside this one. A change touching shared platform data
goes here, **not** in the app that happened to prompt it.

For how the CLI **works** (rather than what changed), run **`bk guide`** — the
complete usage guide, embedded in the binary, so it always describes the version
you are running. For live values (vocabularies, limits, your workspaces), run
**`bk meta`**.

Surfaced at: `GET /api/changelog` (JSON or `?format=markdown`) and `bk changelog`,
which merge every file in this directory into one feed by date, each entry tagged
with its app. `bk changelog --app platform` filters to this file.

> **Process rule:** every change to a route or user-facing feature must add a
> dated entry to the right file. Timestamp it and describe what changed and how
> to adapt.

> **2026-08-04 — this file was created when `docs/api-changelog.md` was split.**
> Phase 5 of the platform migration replaced the single log with one file per app
> plus this one. **The pre-split record lives in `docs/changelog/issues.md`** —
> all of it, moved verbatim, including entries that describe platform concerns.
> Sorting history into a taxonomy invented afterwards is rewriting it. Anything
> dated before 2026-08-04 is in that file regardless of what it touched; read the
> unfiltered feed (`bk changelog`) when looking back.

---

## 2026-08-06 — A file belongs to the app you uploaded it THROUGH

**Nothing changed about how you upload.** `POST /api/upload` and the
client-direct `/api/upload/blob` handshake take the same inputs, enforce the same
100MB cap and the same blocked content types, and return the same bodies.

**What is now guaranteed rather than incidental:** an upload is attributed to the
app whose origin served the request — in *both* places that record it.

| | what it is | set from |
|---|---|---|
| `platform.uploads.app` | who owns the file. The cross-app delete gate reads this to decide whose reference scan must answer for it | the serving app |
| the blob pathname prefix | `<app>/<workspace>/<file>` — where the bytes physically are | the serving app |

**If you are looking at a document filed under the wrong app, this is why.** A
sales file uploaded through `issues.blackcode.ch` is an issues file, in the
issues folder, permanently — nothing moves a blob afterwards, and `pathname` is a
historical fact rather than something derived from `app`. Upload through the
origin that owns the content: `bk upload --server https://sales.blackcode.ch`,
or just the deployment you are working in.

Both upload routes are now served from one shared implementation that takes its
identity from the app mounting it, which is what lets a second deployment serve
its own `/api/upload` instead of 404ing on it. Until a second app is deployed,
the only origin serving these is the issues one, exactly as before.

**One wording change, non-breaking:** the client-direct handshake rejected SVG
with `SVG files are not allowed for security reasons`; it now names the type it
refused (`image/svg+xml files are not allowed for security reasons`) and reads
the blocked list from the same place `GET /api/meta` serves it as
`media.blocked_mime_types`. The multipart route's `file_type_not_allowed` error
code and status are unchanged, and the set of refused types is identical. It had
been a second, hand-typed copy of that list; adding a type to the blocklist would
previously have taken effect on one of the two upload paths and not the other.


## 2026-08-06 — **SECURITY:** a password reset now invalidates token creation too

**What changed.** `GET/POST /api/tokens` and `DELETE /api/tokens/{id}` now reject
a browser session that was issued **before** the account's last password reset,
and one belonging to a deleted account. They previously accepted both.

**Why it matters.** Token management has always been session-only — minting a
`bk_live_…` token with a `bk_live_…` token would be privilege escalation. But the
session check it used was weaker than the one every other session-authenticated
route in the product uses: it confirmed a session existed and resolved the email,
and stopped there. So **a session captured before a password reset could still
mint a long-lived API token afterwards, and revoking that session did not revoke
what it minted.** A password reset is what somebody does when they believe their
account is compromised; one that leaves the attacker able to create a permanent
credential has not done its job.

**How to adapt.** Almost certainly nothing. If you are signed in on a browser and
your password was changed since that sign-in, `/api/tokens` will answer `401`
where it used to work — sign in again. Tokens already minted are unaffected;
this changes who may create and revoke them, not what existing ones can do.

**`bk` users are unaffected.** The CLI authenticates with a token and has never
been able to reach these routes.


## 2026-08-06 — The shared request layer and the first platform route factories

**Nothing about how you call the API changed.** Every route below returns the
same status codes, the same bodies and the same headers as it did yesterday. If
you notice this entry at all, it should be for the one new capability at the end.

**What moved.** The `apiHandler` wrapper and the `resolveWorkspace` gate — auth,
workspace resolution and the per-app access check that every workspace-scoped
route runs — moved out of the issues app into `@blackcode/platform-api`,
parameterised by an `AppContext`. A first set of shared routes moved with them
and are now mounted by each app from one implementation:

`/api/changelog`, `/api/me` (+ `/active-workspace`, `/pending-invitations`),
`/api/tokens` (+ `/{id}`), `/api/users`, `/api/errors/client`, `/api/status`,
`GET /api/workspaces`, and under `/api/workspaces/{ws}`: `search`, `links`,
`members`, `invite-candidates`, `apps`, `activity`.

`/api/meta` did NOT become shared, deliberately: its whole job is telling you
what THIS app's vocabulary is. Its platform half (you, your workspaces, the apps
you can reach, the link relations, the CLI versions) now comes from one place, so
those fields will be identical on every app's origin, but the document stays
per-app and `apps.<slug>.vocabulary` remains the only place an app's enums live.

**Why it matters to a client:** it is what lets a second app serve these on its
own domain. Until now they existed only on the issues host, so an app deployed
elsewhere would 404 on its own `/api/me`, a file uploaded through the wrong host
would be recorded as belonging to the wrong app, and a user granted one app but
not another would get 403 from `bk search`.

**Still served only by the issues deployment**, unchanged: trash, storage,
labels, comments, the inbox, super-admin, `POST /api/workspaces`, `/api/auth/*`,
`/api/upload`, `/api/cli/authorize`, `/api/me/password/*`, `/api/status/errors`,
and the workspace/member/invitation/app-access WRITE routes. Nothing to adapt —
they are where they were.

**New: per-app redaction of error context.** An app can now declare that request
payload must never be written to `platform.error_events.context`. The issues app
does not set it and its behaviour is unchanged; the sales app will.

Its ceiling is stated deliberately, because a privacy control that is believed to
do more than it does is worse than none: **it covers the `context` column, not
the error `message` or `stack`.** A database driver will happily put a rejected
value inside an error message, and scrubbing messages would leave error rows
nobody can act on. The guarantee that does cover everything is retention, which
is a separate, dated commitment.

**Also:** `requireAppAccess` — the 403-with-a-hint you get when you are a member
of a workspace but have not been granted an app in it — is now exported from
`@blackcode/platform-api` rather than `@blackcode/platform-auth`. The check, the
status, the code and the suggestion text are identical. This is an internal
import path; no HTTP client is affected.


## 2026-08-06 — **FIX:** `bk issues --help` said the removed 1.12.0 spellings still worked

Three strings shipped inside the 1.12.0 binary described a world that 1.12.0
itself had changed. No behaviour was wrong — only what the binary said about
itself, which for an agent is the same thing.

**If you read `bk issues --help` on 1.12.0, one line was actively misleading:**

> ~~"Every command below also answers to its old un-namespaced spelling
> (`bk issue list`), which still works and prints one deprecation line."~~

That was true in 1.10.x and 1.11.x. It is **false in 1.12.0** — the aliases were
pruned on schedule, and `bk issue list` exits **2**. Nothing to adapt if you
already use the namespaced form; if you were relying on that sentence, the old
spellings are gone and the error names its replacement.

Also corrected:

- The same help text listed **`undo`** as a platform verb. `bk undo` was removed
  in 1.12.0.
- `bk meta` printed "(the top-level vocabulary/limits/media keys are deprecated
  and **go away in 1.12.0**)". 1.12.0 shipped and the keys are **still served** —
  correctly, since `CLI_MIN_VERSION` is 1.9.1 and every binary from 1.9.1 up
  reads them. The notice no longer names a version: a removal date baked into a
  string cannot be corrected once it is wrong on the copies already installed.
  **The top-level keys remain deprecated. Read `apps.<slug>` instead.**

**Two guardrails were repaired in the same change**, both found by the wrap-up
verification and both of the kind this repo keeps finding — green while checking
less than they claimed:

- `guide_test.go`'s dynamic-value guard was a substring match over six
  hand-written strings. A topic containing the entire issue status vocabulary,
  the entire priority vocabulary and a **stale** `50 MB` limit passed. It now
  matches size limits by *shape* (so a wrong number is caught, not just the right
  one) and counts vocabulary enumerations, while still allowing a worked example
  to name a value.
- The `apps/<a>` → `apps/<b>` **ESLint rule was deleted**. It had been identified
  as inert during the migration and was still passing the real escape shape at
  exit 0. The boundary is enforced by `lib/app-isolation.test.ts`, which resolves
  imports instead of globbing strings — verified by watching it fail. Do not
  re-add the lint rule; a glob cannot express "resolves into a sibling app".

No route changed. No CLI flag, command or exit code changed.

---

## 2026-08-05 — CLI 1.12.0: three breaking changes

**All three are in the CLI. Read all three before upgrading — the trash one can
destroy the wrong item if you reuse an old ref.**

1. **The pre-1.10.0 command spellings stop working.** `bk issue …`, `bk task …`,
   `bk project …`, `bk move`, `bk copy`, `bk analytics` have been deprecated
   aliases since 1.10.0 (two minors, as promised) and are now removed. Use
   `bk issues issue …` and friends. A removed spelling still prints the new one
   rather than "unknown command", so a stale script recovers instead of dying.
2. **`bk trash` refs are `#number`s, not row ids.**
3. **`bk undo` is removed.** It never worked.

Each is detailed below.

### 1. The pre-1.10.0 aliases are gone

On schedule. `cli/internal/commands/deprecations.go` keeps a row for each, so:

```
$ bk issue create --title x
error: unknown command "issue" for "bk"
hint: `bk issue …` is now `bk issues issue …` — app verbs sit behind their app
      name. Same flags, same output.
```

If you pinned to 1.11.x you are unaffected until you upgrade. Agents that read
`bk guide` or ran `bk skill sync` since 1.10.0 already use the new spellings.

### 2. `bk trash` refs are `#number`s, not row ids

`bk trash list`'s **REF** column used to print an internal database row id — the
one place the platform exposed a serial instead of the `#number` used by URNs,
`bk issues issue view`, `bk search` and everything else. It now prints the
`#number`, so `issue:42` in Trash is the same issue as `bk issues issue view 42`.

```bash
bk trash restore issue:42        # 42 is now the #number
bk trash purge   issue:42
```

**⚠️ Do not reuse a ref captured before upgrading.** An old row id is usually a
valid `#number` for a *different* item, and `purge` is not recoverable. Re-run
`bk trash list` and take the current REF. If you have a stored script or an agent
holding refs across this release, that is the one thing to check.

**`bk trash purge` and `bk trash empty` now echo what they destroyed** — type,
`#number` and title, one line per item, followed by the count (`items` in JSON).
Purge is the product's only irreversible action, and the titles exist only up to
the moment the row is deleted. This is also the last defence against a stale ref:
if a pasted ref names something other than what you meant, the title says so
immediately rather than a month later.

The wire format keeps the two unambiguous rather than redefining one:
`{"type":"issue","number":42}` means the #number, `{"type":"issue","id":905}`
still means the row id. **Every pre-1.12.0 binary therefore keeps working
unchanged** — it sends `id`, and the server reads it as a row id exactly as
before. An item carrying both is rejected as ambiguous rather than guessed at.

**Why the field changed shape instead of meaning.** Both spellings were driven
against the same server before this shipped. A 1.11.0 binary printed `issue:953`
and restored the right item; the 1.12.0 binary printed `issue:16` and restored the
right item. **Had `id` simply been redefined to mean the #number, that first call
would have acted on a completely different issue — and on `purge`, destroyed it**,
silently, on every installed binary at once. That counterfactual is the entire
reason for the two-field design.

Also fixed: `bk trash list` reported a `#number` for issues but `null` for
projects and tasks, even though both have had one since migration 0030. All three
now report it. A row with no `#number` shows `—` and a stderr warning rather than
falling back to a row id — such a row can only be restored with `--batch`.

### 3. `bk undo` is removed

It never worked. `platform.transaction_log` had no writer, so the table was empty
in production and `bk undo` reported zero operations every time it has ever been
run. A documented agent-facing command that does nothing is worse than a missing
one: an agent that believes it can undo takes risks it otherwise would not.

**Use Trash instead** — it is the working recovery path and always was:

```bash
bk trash list
bk trash restore issue:42
```

**If your binary is older than 1.12.0 it still HAS `bk undo`**, and running it now
gets this — not a crash, and not a wall of HTML:

```
$ bk undo --count 1 --yes
error: `bk undo` was removed in 1.12.0. It never recorded anything and could not
       undo — the transaction log it read was never written. (410)
hint:  deletes are restorable: `bk trash list`, then `bk trash restore <type>:<#number>`
```

`GET`/`POST /api/undo` return **410 Gone with a `suggestion`** rather than
disappearing. Deleting the route outright handed installed binaries Next's HTML
404 page — roughly 2KB of markup on stderr, no code, no hint, nothing an agent
could act on. That was caught by running the published 1.11.0 binary against the
new build before promoting it, and it is the same treatment `/api/openapi.json`
has had since 2026-08-03. Upgrading is still the right move; you are not stuck
either way.

On 1.12.0 itself, `bk undo` is gone from the command tree and
`limits.undo_max_count` no longer appears in `bk meta`. The empty
`platform.transaction_log` table is left in place for now; dropping it is a
separate change.

The per-issue activity view lost its "changes" half, which read the same empty
table and has returned nothing for its entire existence. Real history is
`platform.events`, which the activity feed and inbox already read.

### Not breaking: `platform.events.app` and `platform.uploads.app` are now `NOT NULL`

The contract half of the expand → migrate → contract started in migrations 0035
and 0036. No client-visible change: all current code sets `app`, which is exactly
the precondition that was verified before tightening (0 NULLs across 3,630 event
rows and 105 upload rows, and neither `recordEvent` nor `recordUpload` lets a
call site omit it). It only matters if you roll the deployment back to a
pre-Phase-6 build — see `docs/sql/phase8-app-not-null-rollback.sql`.

---

## 2026-08-05 — Blob cleanup works across deployments: a shared, database-maintained reference index

**Not breaking.** Nothing you run changes shape. One new super-admin command,
one behaviour that stops being a dead end before it ever becomes one.

**The problem this fixes.** The previous entry made blob deletion ask *every*
enabled app whether it still references a file, and refuse if any app could not
answer. That is the right safety property and it was, as shipped, unsatisfiable:
each app's deployment connects as its own Postgres role and cannot read another
app's tables, so it could never obtain the proof. The moment a second app had
been registered, **blob deletion would have stopped working entirely** — correctly
and uselessly. It never bit anyone only because exactly one app exists.

**What changed.**

- **`platform.blob_references`** — a shared index of `(url, app, source_type,
  source_id, workspace_id)`. Any deployment can read the whole picture without
  reading any app's tables, so "does anything still point at this file?" is now
  answerable across deployments.
- **It is maintained by Postgres triggers, not by application code.** Every
  content table that can hold a file URL carries a trigger that recomputes that
  row's references on insert, update and delete. This is the important detail: an
  index maintained by application writes can be forgotten by a new write path,
  and a *missing* row means a file still in use is reported as an orphan and
  deleted. Triggers move the obligation from every writer to the schema.
- **`platform.apps.maintains_blob_index`** — set by an app's own migration, in
  the same file that installs its triggers. An enabled app is answerable either
  because its scanner runs in this process (scanned live, and still preferred) or
  because it has declared the index. Neither is still an **error**, never a
  "no references": the gate did not loosen, it gained a second admissible proof.
- **`bk super-admin blob-drift`** (`GET`/`POST /api/super-admin/blob-drift`) —
  re-derives the index from a live scan and reports the difference, the sibling of
  `bk super-admin entity-drift`. `--repair` fixes it; `--workspace` narrows it.
  Read a repair that changes something as a bug report. Two counts are kept apart
  deliberately: `missing` is a file another deployment could delete while it is in
  use, `orphaned` is only leaked bytes.
- **App roles hold `SELECT` on the index and nothing more.** The triggers are
  `SECURITY DEFINER`, so no app can forge or erase another app's references. If
  you add an app role, `docs/sql/app-role.sql` step 5b is not optional.

**Also fixed along the way.** `issues.attachments.workspace_id` had been NULL on
every row since the column was added, which meant the Storage page and
`bk storage list` never attributed attachment references to a workspace. It is
backfilled from the parent issue. The delete gate was never affected — it matches
on URL alone — but the reconciler would have had a silent blind spot over a fifth
of the index, so `blob-drift` now also counts rows no workspace pass can reach and
reports them separately from drift.

**How to adapt.** Nothing, unless you are adding an app: then run its migration's
trigger installation and set `maintains_blob_index`, or blob deletion in every
other deployment will refuse (safely) until you do. `docs/adding-an-app.md` has
the ordered steps.

---

## 2026-08-05 — Uploads are attributed to an app, and cleanup asks every app before deleting

**What changed.**

- **Every stored file now records which app uploaded it.** `platform.uploads`
  gained an `app` column, backfilled to `issues` for everything that already
  existed. `bk storage list` shows it in a new **APP** column, and
  `--app <slug>` (`?app=` on `GET /api/workspaces/{ws}/storage`) narrows the list
  to one app's files.
- **New uploads are written under an app prefix:** `<app>/<workspace>/<file>` —
  e.g. `issues/acme/1712-report.pdf`. **Existing files were not moved**, and never
  will be: every url is absolute and the ledger records where each file actually
  lives, so a path is a historical fact, not something to derive.
- **Reference counting is app-aware.** Whether a file may be deleted used to be
  answered by scanning this app's tables. It is now answered by every app that
  has registered a reference scanner, and a file is deletable only when **no
  app** references it.

**Why it matters to you.** Deleting is the operation that got safer, and in one
direction only: the checks that refuse a delete were added to, never relaxed.
`bk storage rm` and the automatic sweep behind a comment hard-delete or a Trash
purge now refuse whenever the answer cannot be *proven* — including when an app
is registered but its scanner is unreachable. A refusal you did not expect means
"could not prove this file is unused", not "the file is in use".

**How to adapt.**

- Nothing is required. `bk storage list` gains a column; existing JSON fields are
  unchanged and additive (`app` on each file, `app` on each entry of
  `references`).
- If you parse the table output of `bk storage list` by column position, the new
  APP column sits between ID and FILENAME. Use `--json` if that matters.
- `bk storage list --app issues` is the filtered form. Usage totals stay
  workspace-wide whichever filter is applied — storage is shared, and a total
  that shrank with a filter would read as free space.
- Files uploaded before this release keep their flat pathnames and are attributed
  by the ledger, so `--app issues` includes them.
- **Older `bk` binaries keep uploading normally.** The CLI uploads client-direct
  too, and a client that predates the prefix convention sends a bare filename;
  the server accepts it and the file lands flat at the store root, still
  attributed to `issues` in the ledger. Nothing about uploading requires an
  upgrade. From the next CLI release, `bk` reads `app` and `workspace` from
  `GET /api/upload` and sends the prefixed path itself.

---

## 2026-08-05 — **FIX:** `bk trash restore` reported success for a ref that did not exist

**What changed.** `POST /api/workspaces/{ws}/trash/restore` now answers **404
`not_in_trash`** when a requested ref is not in that workspace's Trash. It used to
answer `200 { count: 1 }` — so `bk trash restore` printed `restored 1 item(s)` and
exited **0** while restoring nothing.

**Why it mattered more than it looks.** The ref you pass is the one `bk trash
list` prints in its REF column, which is *not* the `#number` used everywhere else.
Pass the `#number` by mistake — the natural thing to do — and you got a
confident success for a no-op. An id belonging to a **different workspace** got
the same answer. An agent branching on exit code and count was told the item was
back while it was still binned, and nothing anywhere reported otherwise. Found
against production while verifying Phase 6.

**Cause,** for anyone reading the diff: one `Set` was doing three jobs — recursion
guard, "this parent is active so children may re-link", and the report of what
came back — and the does-not-exist branch added to all three. It is now two sets,
and only the one holding rows actually taken out of the bin is reported.

**How to adapt.**

- A bad ref is now **exit 5** with the ref named and a `hint:` pointing at
  `bk trash list`. If you were treating a non-zero count as proof, you can now
  treat the exit code as proof.
- **A rejected restore is atomic** — pass one bad ref alongside good ones and
  nothing is restored, rather than a partial restore reported as complete.
- **The count is now what was actually restored.** Restoring something that was
  never binned is a no-op that counts **zero** and still succeeds; previously it
  counted one.
- `purge` and `empty` were never affected: `purgeOne` already reported only what
  it removed.

Not fixed here, and carried forward: `bk trash` refs are internal database ids
(`issue:905`), which is the one place the platform exposes a work-item serial
instead of its `#number`. That is a design decision — map them, or document Trash
as a deliberate exception — not a one-function fix.

---

## 2026-08-05 — Cross-app entities: URNs, `bk search`, `bk link`, and a merged `bk activity`

**What changed.** Everything in every app is now addressable by one string, and
three new capabilities fall out of that. This is additive — nothing that worked
before behaves differently.

### URNs

```
bc:<app>:<workspace-slug>/<entity-type>/<number>
bc:issues:kali-sa/issue/482
```

`<number>` is the **workspace #number** — the `#N` shown in the app — never the
internal database id, consistent with every other surface. `<workspace-slug>` is
the slug, so a URN is readable and its tenant is visible without a lookup.

Do not assemble a URN from guessed parts. Get one from `bk search`, or from the
new `subject_urn` field on an activity entry.

### `bk search <query>` — federated search

```bash
bk search auth                       # titles matching "auth", any app
bk search "#482"                     # by workspace #number
bk search acme --type issue,project --json
bk search draft --include-deleted    # include the recycle bin
```

Searches **titles and #numbers**, across every app, in the active workspace
(`--ws` targets another). It reads the shared entity index, not each app's own
tables — which is what makes it a single query rather than a fan-out. To search
descriptions or filter by status/assignee/label, keep using the app's own listing
(`bk issues issue list --search`).

Route: `GET /api/workspaces/{ws}/search`.

### `bk link` — typed relations between two URNs

```bash
bk link create bc:issues:acme/issue/12 bc:issues:acme/project/3 --rel part_of
bk link list bc:issues:acme/issue/12
bk link rm bc:issues:acme/issue/12 bc:issues:acme/project/3 --rel part_of
```

Links are **directed and stored once**: `A blocks B` shows as an outgoing link on
A and an incoming one on B, with no inverse row to keep in step. Run `bk meta`
for the accepted relation names — they are served under `links.relations` and can
change without a CLI release, so they are not baked into the binary or the guide.

Behaviour worth knowing before you script against it:

- Both ends must exist and must be in the **same workspace**. A cross-workspace
  link is refused (400 `cross_workspace_link`); an unknown end is 404
  `entity_not_found` and names which end was missing.
- Creating the same link twice **succeeds** and reports `created: false`.
  Retrying after a timeout is safe.
- `bk link rm` needs from, to *and* `--rel`: direction is part of the identity.
- **Binned** items keep their links (flagged as in the trash) and restore with
  them. **Purged** items take their links with them. A **workspace rename**
  rewrites every URN and the links follow — but a URN you cached before the
  rename stops resolving, so re-fetch rather than storing them long-term.

Routes: `POST`, `GET`, `DELETE /api/workspaces/{ws}/links`.

### `bk activity` is now a cross-app feed

Every event carries the **app that produced it** and, where its subject is an
addressable entity, that entity's **`subject_urn`**. Three new flags:

```bash
bk activity --since 24h                              # 30m | 24h | 7d
bk activity --app issues
bk activity --subject bc:issues:kali-sa/issue/482    # one thing's full history
```

`--since` and `from=` are mutually exclusive (400 `since_and_from`). Entries about
members, invitations, labels and comments carry no `subject_urn` — those are real
events about things with no cross-app address.

Also fixed here: `?entity_type=workspace_app` and the five `app_*` actions added
in Phase 4 were never added to the activity filter's allow-list, and an
unrecognised value **dropped the filter silently** rather than rejecting it — so
`?action=app_access_granted` returned the whole feed. Both lists are now complete.

### `bk meta` additions

- `links.relations` — the relation names the server accepts, plus `urn_format`
  and a worked `urn_example`.
- `apps.issues.entity_types` — the entity types this app publishes, i.e. what
  `bk search --type` and the `<entity-type>` URN segment accept here.

Nothing was removed or renamed.

### `bk super-admin entity-drift` — the reconciliation job

The entity index is a **projection**: each app's own tables are the truth, and
every write updates both in one transaction. This command re-derives the whole
projection and reports the difference — `missing` (a source row with no entry),
`stale` (title, url or trashed state disagree), `orphaned` (an entry with no
source row). `--repair` fixes all three; `--workspace <slug>` narrows the scope.

Read a repair that changes something as a **bug report**, not as maintenance.

Routes: `GET` / `POST /api/super-admin/entity-drift` (super admin only).

### Schema

Migration `0035` — purely additive. New `platform.entities` and `platform.links`;
`platform.events` gains nullable `app` and `subject_urn`, both backfilled.
`events.app` is nullable rather than `NOT NULL DEFAULT 'issues'` on purpose: the
migration lands before the deploy that writes it, so old code is still inserting
rows during that window, and defaulting a platform table to one app's name is the
coupling this work exists to remove. It tightens to `NOT NULL` in a later release
once no deployed code can write a NULL.

**How to adapt.** Nothing is required. If you have been pasting dashboard URLs
into descriptions to express "this relates to that", `bk link` is the replacement
that survives renames and is queryable.

---

## 2026-08-04 — **BREAKING (CLI):** app commands moved behind their app name

**What changed.** Every command that belongs to an *app* now sits behind that
app's name. Platform commands — the ones that mean the same thing whichever app
you are working in — stay exactly where they were.

| Before | Now |
|---|---|
| `bk issue …` | `bk issues issue …` |
| `bk task …` | `bk issues task …` |
| `bk project …` | `bk issues project …` |
| `bk move …` / `bk copy …` | `bk issues move …` / `bk issues copy …` |
| `bk analytics …` | `bk issues analytics …` |

Unchanged and still bare: `login`, `meta`, `guide`, `changelog`, `workspace`,
`app`, `label`, `member`, `invite`, `token`, `profile`, `inbox`, `upload`,
`storage`, `trash`, `undo`, `activity`, `user`, `super-admin`, `skill`,
`version`.

**Nothing breaks today.** Every old spelling still runs, takes the same flags and
prints the same output. It writes one extra line to **stderr** naming the
replacement:

```
$ bk issue list --json
deprecated: use 'bk issues issue list'
{ "data": [ … ] }
```

stdout is untouched, so piping into `jq` keeps working. **These aliases are
removed two minor releases from now (1.12.0).** After that the old spelling exits
non-zero and the error names the new one.

**How to adapt.** Insert `issues` after `bk` for the five nouns in the table.
That is the whole migration. `bk --help` lists platform verbs first, then one
line per app; `bk issues --help` lists just that app's nouns.

**Why now, with one app.** Every app eventually wants a `report`, a `note`, a
`status`. `bk sales deal create` says which app it is and `bk deal create` does
not. Doing this with one app is a rename; doing it with three is a migration with
a collision to resolve first.

**`CLI_MIN_VERSION` was not raised.** Older binaries keep working — the floor
moves a release later, once adoption is visible, so nobody is locked out with
nothing to upgrade to.

---

## 2026-08-04 — `bk guide` topics are now section-qualified, and `--app` scopes them

**What changed.** Guide topics are grouped one directory per section:
`platform/…` for what is true in every app, `<app>/…` for one app's behaviour.
Slugs carry the section:

```
platform/overview   platform/install-auth   platform/workspaces
platform/rich-text  platform/files          platform/storage
platform/output-and-exit-codes              platform/undo-and-trash
platform/encoding   platform/pitfalls       platform/staying-current
issues/items        issues/move-copy        issues/pitfalls
```

`bk guide` prints platform first, then each app under its own heading.
`bk guide --app issues` prints one app; `bk guide --app platform` prints the
shared half. `bk guide --list` and `--json` gain a `section` field per topic.

**Not breaking.** A bare slug still resolves while it is unambiguous, so
`bk guide files` and `bk guide items` keep working — every skill written before
today says exactly that, and breaking those in the same release that renames the
commands would leave an agent unable to read the topic explaining the rename.
`pitfalls` now exists in two sections, so the bare form there reports the
ambiguity and names both candidates (`platform/pitfalls`, `issues/pitfalls`)
rather than guessing. It exits 2.

**Also:** `issues/pitfalls` is new — the mistakes specific to this app, split out
of the general list, which keeps the ones that bite everywhere.

---

## 2026-08-04 — The changelog is one file per app, merged into one feed

**What changed.** `docs/api-changelog.md` became `docs/changelog/platform.md` +
`docs/changelog/issues.md`. `bk changelog` and `GET /api/changelog` merge every
file by date into a single newest-first feed, and each entry now carries which
app it belongs to.

**Response shape — additive, nothing removed.** Each entry gains `app`:

```jsonc
{ "date": "2026-08-04", "app": "platform", "title": "…", "markdown": "…", "html": "…" }
```

New: `bk changelog --app issues` (or `platform`) filters, and
`GET /api/changelog?app=issues` does the same. `?format=markdown` returns the
merged document with an app tag per entry.

**History was moved, not rewritten.** Every pre-split entry is in `issues.md`,
verbatim and un-re-dated, including the many that describe platform concerns.
Read the unfiltered feed for anything before today.

**Fixed while splitting:** the parser treated a `## ` line *inside a fenced code
block* as the start of a new entry, so `bk changelog` had been serving a phantom
undated entry titled "Our team's rules            <- yours; preserved forever"
— lifted out of a SKILL.md example in the 2026-08-03 entry. Entry splitting is
now fence-aware, and a test asserts every entry has a real date.

---

## 2026-08-04 — `bk meta` now carries each app's vocabulary under `apps.<slug>`

**What changed.** The vocabulary, limits and media rules `bk meta` returns are
now also published *inside* the app they belong to:

```jsonc
{
  "user": …, "workspaces": […], "cli": …,
  "current_app": "issues",
  "apps": {
    "issues": {
      "slug": "issues", "name": "Blackcode Issues", "is_current": true,
      "base_url": "https://issues.blackcode.ch",
      "workspaces": ["kali-sa", …],
      "vocabulary": { "issue_statuses": […], "issue_priorities": […],
                      "project_statuses": […], "project_priorities": […],
                      "project_update_health": […] },
      "limits": { … },
      "media":  { … }
    }
  },

  // deprecated — identical values, removed in 1.12.0
  "vocabulary": { … }, "limits": { … }, "media": { … }
}
```

**The old top-level keys are still there and still correct.** `vocabulary`,
`limits` and `media` remain at the root for **two minor releases**, then go
away. They are served from the same objects as the nested copies, so the two
cannot disagree during the overlap. Move your reads to `apps.issues.*` now.

**Only the current app's entry carries a vocabulary,** and that is deliberate.
This server is the issues app; it knows its own enums and has no business
publishing another app's. Read a different app's vocabulary from its own
`/api/meta` — that is what `base_url` is for. A merged registry here would be a
hand-maintained copy of facts owned elsewhere, which is the thing that drifted
and got deleted on 2026-08-03.

**Why.** Two apps must never share one top-level enum list — an agent has to be
structurally unable to send a sales stage to the issue tracker. `apps` is an
object keyed by slug, so this was additive: a second app appears as a new key,
and nothing an agent already parses changes shape.

`bk meta`'s table view gains a COMMANDS column naming each app's command prefix,
and points at `apps.<slug>` on stderr; `bk meta --json` prints the server's
response verbatim, so the nested block is visible without a CLI upgrade.

---

## 2026-08-04 — Invitation tokens starting with `-` are now accepted (and no longer minted)

**The bug.** Invitation tokens are base64url, whose alphabet includes `-`. Any
token that began with one could not be redeemed: `bk invite accept -Jx7…` made
the CLI read the token as a flag and fail with `unknown shorthand flag: 'J'`
before the request was ever sent. Roughly **1 invitation in 32** was affected,
and the failure looked like a bad token rather than a CLI bug.

**Fixed at both ends.** `bk invite accept` and `bk invite decline` now read their
argument literally — no `--` separator or quoting needed — and the server no
longer generates a token starting with `-`. Both were necessary: the CLI fix
serves tokens already sitting in inboxes, and the server fix protects the
binaries already installed, which cannot be upgraded retroactively.

**No action needed.** Existing pending invitations are unaffected and remain
valid; a token that failed before will now work with `bk` 1.10.0 or later.

---

## 2026-08-04 — A server `suggestion` is no longer printed twice

**What changed.** When a request failed, the CLI printed the server's
`suggestion` on both the `error:` line and the `hint:` line:

```
error: you do not have access to the issues app here (403) — ask a workspace owner…
hint: ask a workspace owner…
```

Now `error:` states what failed and `hint:` states what to do about it — one
fact, one line. Nothing was removed: every suggestion still reaches stderr,
once. `details` (a field-level validation reason) stays on the `error:` line,
because it is part of what failed rather than advice about it.

**If you parse stderr,** match the `hint:` prefix for recovery advice. This
became routine traffic when per-app access shipped on 2026-08-04, which is what
surfaced it.

---
