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
