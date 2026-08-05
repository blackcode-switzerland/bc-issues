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
