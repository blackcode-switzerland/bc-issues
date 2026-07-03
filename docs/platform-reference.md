# Platform Reference — baseline

**Product:** blackcode issues — an AI-native, Linear-style issue tracker.
**This document covers:** REST API `v1.1.0` · `bk` CLI `v1.8.6` · baseline dated **2026-07-03**.

This is the pinned **baseline reference**: a complete snapshot of everything you
can do through the API and the CLI, the data types involved, and the rules and
pitfalls to know. If you (or an agent skill) have been away for a while, read
this once top to bottom to get fully current, then skim the dated
[changelog](/changelog) below for anything newer than this baseline.

> **The one thing to internalise:** the same workspace data is reachable three
> ways — a **web UI** (`/dashboard`, for humans), a **Go CLI** (`bk`, recommended
> for agents/scripts), and an **HTTP API**. The CLI and API are the programmatic
> surfaces and they never disagree, because they are generated/validated against
> the same spec. When something used to work and now fails, the cause is almost
> always a change listed in the [changelog](/changelog) — check it first.

---

## 1. Recommended interface: the `bk` CLI

For programmatic and agent use we **recommend the `bk` CLI over calling the HTTP
API directly.** It wraps the exact same endpoints but handles auth, JSON-body
encoding, pagination, file upload+embed, and returns **stable exit codes** —
which makes automated runs markedly more reliable. The raw HTTP API stays fully
supported; reach for it when the CLI can't cover a case (an urgent one-off, a
language without the binary). It's a recommendation, not a requirement.

```bash
# Install (npm; a small launcher downloads the right prebuilt binary)
npm install -g @blackcode_sa/bc-issues

# Authenticate (opens a browser to capture a token), then bootstrap
bk login                       # or: bk login --server https://your-host
bk meta                        # who am I + every workspace I can write to
bk workspace use <slug>        # pick the active workspace (by name/slug, not id)

# Do work
bk project list
bk issue create --project 4 --title "Fix login" --priority 2
bk issue list --project 4 --mine
```

The npm package name is **`@blackcode_sa/bc-issues`**; the binary is **`bk`**.
Update at any time with `npm install -g @blackcode_sa/bc-issues@latest`.

---

## 2. Authentication

Two ways to authenticate; **every** request uses one of them:

| Surface | How |
|---|---|
| HTTP API | HTTP header `Authorization: Bearer bk_live_<token>` |
| CLI | `bk login` stores the token; it's sent automatically |
| Web UI | a normal browser session (NextAuth) |

- **Mint a token:** in the web UI at **Settings → API Tokens**
  (`/dashboard/settings/tokens`), or just run `bk login`. Tokens are shown
  **once** at creation — store them then; the server keeps only a hash.
- Tokens look like `bk_live_…`. They can carry an optional expiry.
- **Token management is session-only:** you cannot mint or revoke tokens *using*
  a token — `POST /api/tokens` and `DELETE /api/tokens/{id}` require a browser
  session. This is deliberate (a leaked token can't mint more).
- A missing/invalid token returns **401**; an authenticated-but-not-allowed
  action returns **403**.

---

## 3. Choose the right workspace FIRST

All tenant data lives inside a **workspace**, and most accounts belong to more
than one. Picking the wrong one is the single most common agent mistake.

1. Call **`GET /api/meta`** (or `bk meta`). It returns `workspaces` — every
   workspace you belong to as `{ id, name, slug, role, is_active }` — plus the
   current `active_workspace`.
2. Match the user's intent to a workspace by its **human-readable `name`/`slug`**,
   **never** by the numeric `id` (ids are opaque sequential integers, trivial to
   confuse).
3. Address it in routes as `/api/workspaces/{slug}/…` (the `{ws}` segment accepts
   a slug or an id — prefer the slug). In the CLI, set it once with
   `bk workspace use <slug>` or target a single command with `bk --ws <slug> …`.

`active_workspace` is only a **default**, not necessarily where the user means to
write. Confirm before creating anything.

---

## 4. Response envelopes & conventions

| Case | Shape |
|---|---|
| Single resource | the bare entity object (no wrapper) |
| List | `{ "data": [...], "next_cursor": number \| null }` — issues also add `"total"` |
| Create | HTTP **201** with the created entity |
| Delete | HTTP **200** `{ "deleted": true }` (may add `"mode": "cascade" \| "detach"`) |
| Error | `{ "error": string, "code": string, "suggestion"?: string, "details"?: object }` |

- **The `id` of a project / task / issue is its workspace `#number`** (the `#N`
  shown in the app), unique per workspace. Address everything by it. The internal
  global database id is **never exposed**. Fields that reference a work item —
  `comment.parent_id`, `attachment.issue_id`, `project_update.project_id`,
  `issue.project_id`, `issue.task_id`, `task.project_id` — are this `#number` too.
- **Pagination:** most lists (issues, projects, tasks) return **everything in one
  response** (`next_cursor` is `null`). Only the keyset feeds paginate via
  `?limit=&cursor=`: **activity**, **trash**, and **super-admin errors**. Follow
  `next_cursor` until it's `null`.
- **Error codes** are machine-readable, e.g. `invalid_title`, `issue_not_found`,
  `file_in_use`. Branch on `code`, show `error`/`suggestion` to a human.

---

## 5. Data types & vocabularies (enums)

These are the valid values for the status/priority/health fields. They are the
single source of truth (`lib/work-items.ts`) and are echoed live by
`GET /api/meta` (`vocabulary`) and the OpenAPI spec — **fetch `/api/meta` if you
want to be certain they haven't changed since this baseline.**

**Issue status** (`status`, string):
`backlog` · `todo` · `in_progress` · `done` · `cancelled`
(terminal = `done`, `cancelled`).

**Issue priority** (`priority`, integer 1–5):
`1` = Urgent · `2` = High · `3` = Medium · `4` = Low · `5` = No priority.

**Project status** (`status`, string):
`backlog` · `planned` · `in_progress` · `completed` · `cancelled`.

**Project priority** (`priority`, string P0–P4):
`P0` = Urgent · `P1` = High · `P2` = Medium · `P3` = Low · `P4` = No priority.
*(CLI `--priority` accepts the friendly words `urgent|high|medium|low|none`.)*

**Project update health** (`status` on a project update):
`on_track` (green) · `at_risk` (yellow) · `off_track` (red).

**Dates** are ISO-8601. To **clear** a nullable field on edit (assignee, task,
due-date, start-date) send the literal `none` (CLI also accepts
`null`/`unset`/`clear`); **omit** the field to leave it unchanged.

---

## 6. Rich text, file uploads & storage

**Rich text.** Description / comment / project-update body fields accept
**Markdown or HTML** and are stored as **sanitized HTML**. Send **real
newlines**, not the literal characters `\n`. GFM Markdown tables (and HTML
`<table>`) render as real tables. Raw `<iframe>` and **external** (non-uploaded)
media are stripped on render.

**Embedding files/images.** Upload first, then reference the returned url in a
body:
1. `POST /api/upload` (multipart, field `file`) → `{ url }`. Max **100 MB**.
2. Put the url in the body as `![name](url)` (image → inline preview) or
   `[name](url)` (any other file → video/audio player or download card). The
   server recognises our upload urls and upgrades them automatically.

CLI shortcuts do upload+embed in one step: `bk issue|task|project create --file
./x`, `bk issue comment <id> --file ./x`, or `bk upload <file>` to just print a
url. `bk issue attach <id> --file ./x` is different — it adds to the issue's
**attachments list** (sidebar), not the body.

**Storage.** Uploads are tracked per workspace. *Editing* a file out of a body
never deletes the bytes (so undo/restore stay safe). *Terminal* deletes do free
storage automatically: hard-deleting a comment/reply or purging an item from
Trash removes files that content referenced once nothing else references them. A
workspace **owner** can review and clean up: `GET /api/workspaces/{ws}/storage`
lists every file with its live `references` + usage; `DELETE
/api/workspaces/{ws}/storage/{id}` permanently removes an orphan (refused
**409 `file_in_use`** if anything, including a trashed item, still references it).

---

## 7. The REST API — every endpoint

Base path `/api`. Tenant data is workspace-scoped under
`/api/workspaces/{ws}/…`. `{ws}` = workspace slug or id; `{id}` = the entity
`#number`. All routes need a bearer token except those marked **public**.

### Discovery & account

| Method | Path | What |
|---|---|---|
| GET | `/api/meta` | **Start here.** User, active workspace, all your workspaces, the enum vocabulary, plus the active workspace's labels/projects/members. |
| GET · PATCH · DELETE | `/api/me` | Current user; update profile; delete account (`?check=1` dry-run). |
| POST | `/api/me/active-workspace` | Set the active workspace. |
| GET | `/api/me/inbox` | Inbox notifications (`unread`, `count_only`, `archived`, `type`, `workspace_id`). |
| POST | `/api/me/inbox/mark-read` · `/archive` · `/unarchive` | Manage inbox messages. |
| GET | `/api/me/pending-invitations` | Invitations awaiting your response. |
| POST | `/api/me/password/request-otp` · `/confirm` | Change password (in-app). |
| GET | `/api/users` | Users visible to you (workspace-mates). |

### Workspaces

| Method | Path | What |
|---|---|---|
| GET · POST | `/api/workspaces` | List your workspaces; create one (201). |
| GET · PATCH · DELETE | `/api/workspaces/{ws}` | Detail; update; delete (owner). |
| POST | `/api/workspaces/{ws}/leave` | Leave a workspace. |
| POST | `/api/workspaces/{ws}/transfer` | Transfer ownership. |
| POST | `/api/workspaces/{ws}/move` | Move/copy projects·tasks·issues to another workspace (atomic). |
| GET | `/api/workspaces/{ws}/members` | List members. |
| DELETE | `/api/workspaces/{ws}/members/{userId}` | Remove a member (owner). |
| GET · POST | `/api/workspaces/{ws}/invitations` | List; create (201). |
| DELETE | `/api/workspaces/{ws}/invitations/{id}` | Revoke an invitation. |
| GET | `/api/workspaces/{ws}/invite-candidates` | Suggested people to invite. |
| GET | `/api/workspaces/{ws}/activity` | Activity feed (**paginated**: `limit`/`cursor`). |
| GET | `/api/workspaces/{ws}/analytics` | Analytics (shape depends on `view`). |

### Issues

| Method | Path | What |
|---|---|---|
| GET · POST | `/api/workspaces/{ws}/issues` | List (`{ data, total }`, filters `project_id`/`search`); create (201). |
| PATCH | `/api/workspaces/{ws}/issues/reorder` | Reorder. |
| GET · PATCH · DELETE | `/api/workspaces/{ws}/issues/{id}` | Detail; update; move to Trash. |
| GET | `/api/workspaces/{ws}/issues/{id}/activity` | Per-issue activity. |
| GET · POST | `/api/workspaces/{ws}/issues/{id}/comments` | List; add (201). |
| GET · POST | `/api/workspaces/{ws}/issues/{id}/labels` | List; attach (201). |
| DELETE | `/api/workspaces/{ws}/issues/{id}/labels/{lid}` | Detach. |
| GET · POST | `/api/workspaces/{ws}/issues/{id}/attachments` | List; attach an uploaded file (201). |
| DELETE | `/api/workspaces/{ws}/issues/{id}/attachments/{attachmentId}` | Remove. |
| GET · POST · DELETE | `/api/workspaces/{ws}/issues/{id}/watch` | Get / set / clear watch state. |

### Projects

| Method | Path | What |
|---|---|---|
| GET · POST | `/api/workspaces/{ws}/projects` | List; create (201). |
| PATCH | `/api/workspaces/{ws}/projects/reorder` | Reorder. |
| GET · PATCH · DELETE | `/api/workspaces/{ws}/projects/{id}` | Detail; update; delete (`?mode=cascade\|detach`). |
| GET · POST · DELETE | `/api/workspaces/{ws}/projects/{id}/members` | List; add (201); remove. |
| GET · POST | `/api/workspaces/{ws}/projects/{id}/comments` | List; add (201). |
| GET · POST | `/api/workspaces/{ws}/projects/{id}/updates` | List; post a status update / health (201). |
| DELETE | `/api/workspaces/{ws}/projects/{id}/updates/{updateId}` | Delete an update. |

### Tasks

| Method | Path | What |
|---|---|---|
| GET · POST | `/api/workspaces/{ws}/tasks` | List (filters `project_id`/`search`); create (201). |
| GET · PATCH · DELETE | `/api/workspaces/{ws}/tasks/{id}` | Detail (`?includeIssues=true`); update; delete (`?mode=`). |
| GET · POST | `/api/workspaces/{ws}/tasks/{id}/comments` | List; add (201). |

### Labels & comments

| Method | Path | What |
|---|---|---|
| GET · POST | `/api/workspaces/{ws}/labels` | List; create (201). |
| GET · PATCH · DELETE | `/api/workspaces/{ws}/labels/{id}` | Detail; update; delete. |
| PATCH · DELETE | `/api/workspaces/{ws}/comments/{id}` | Edit / delete a comment (hard delete frees referenced files). |

### Storage & trash

| Method | Path | What |
|---|---|---|
| GET | `/api/workspaces/{ws}/attachments` | All attachment rows in the workspace (owner). |
| GET | `/api/workspaces/{ws}/storage` | Files + references + usage (owner). |
| DELETE | `/api/workspaces/{ws}/storage/{id}` | Permanently delete an orphan file (409 if referenced). |
| GET | `/api/workspaces/{ws}/trash` | List trashed items (**paginated**). |
| POST | `/api/workspaces/{ws}/trash/restore` · `/empty` | Restore; empty. |
| DELETE | `/api/workspaces/{ws}/trash/purge` | Permanently purge specific items. |

### System, uploads & discovery

| Method | Path | What |
|---|---|---|
| GET | `/api/status` | **Public** health probe. |
| GET · POST | `/api/tokens` · DELETE `/api/tokens/{id}` | API tokens (**session-only**). |
| GET · POST | `/api/undo` | List the undo log; undo the last op(s) (`{ count }`, max 10). |
| POST · GET | `/api/upload` | Upload a file → `{ url }`; GET returns constraints (`{ blob, maxBytes }`). |
| GET | `/api/changelog` | **Public.** This reference + the dated log (JSON, or `?format=markdown`). |
| GET | `/api/openapi.json` | Full OpenAPI 3.1 spec. |
| GET | `/api/docs` | Human-browsable API reference (Scalar). |
| POST | `/api/auth/register`, `/api/auth/password-reset/*`, `/api/cli/authorize` | **Public** auth flows. |

### Super admin (requires a `SUPER_ADMINS` email)

| Method | Path | What |
|---|---|---|
| GET | `/api/super-admin/users` | All users. |
| GET · DELETE | `/api/super-admin/errors` · `/errors/{id}` | Error events: list/triage/delete. |
| GET · POST · DELETE | `/api/super-admin/whitelist` · `/whitelist/{id}` | Sign-up whitelist. |

---

## 8. The `bk` CLI — every command

Run `bk <group> --help` then `bk <group> <cmd> --help` to see flags. Global
flags on every command: `--ws <slug\|id>` (target one command at a different
workspace), `-v/--verbose` (log HTTP to stderr; or `BK_DEBUG=1`), and the output
flags `-o table|json|yaml` / `--json` / `--yaml` (default `table`).

| Group | Commands |
|---|---|
| **session** | `login` (`--server`, `--token`), `logout`, `whoami`, `version`, `meta` |
| **profile** | `profile view`, `profile edit` (`--name`, `--tagline`, `--avatar-url`) |
| **workspace** | `list`, `show`, `create --name`, `use <slug>`, `edit`, `transfer --to` |
| **move / copy** | `move` / `copy` `--to <ws>` `--project`/`--task`/`--issue` (repeatable) `--cascade-tasks` `--cascade-issues` |
| **project** | `list`, `view`, `create`, `edit`, `delete` (`--cascade`/`--detach`), `members`, `add-member`, `remove-member`, `updates {list,add,delete}`, `comment(s)`, `issues`, `tasks` |
| **issue** | `list` (`--project`,`--status`,`--assignee`,`--mine`,`--search`), `view`, `create`, `edit`, `delete`, `assign`/`unassign`, `comment(s)`, `edit-comment`, `delete-comment`, `attach`/`detach`, `attachments`, `watch`/`unwatch`, `activity` |
| **task** | `list`, `view` (`--include-issues`), `create`, `edit`, `delete`, `comment(s)` |
| **label** | `list`, `view`, `create --name [--color]`, `delete`, `attach <issue> <label>`, `detach` |
| **member** | `list`, `remove <userId>`, `leave` |
| **invite** | `send <email>`, `list [--all]`, `revoke`, `accept <token>`, `decline`, `pending` |
| **token** | `list`, `create --name [--expires-at]`, `delete` |
| **inbox** | `list [--unread]`, `read [id…]/--all`, `archive`, `unarchive` |
| **user** | `list`, `view <id\|email>` |
| **files** | `upload <file…>`, `storage {list,rm,attachments}` |
| **activity/analytics** | `activity` (`--limit`,`--cursor`), `analytics` (`--view`,`--from`,`--to`,`--interval`,…) |
| **trash** | `list`, `restore <type:id…>`, `purge`, `empty` |
| **undo** | `undo --count N` (1–10) |
| **changelog** | `changelog` (lists changes), `changelog --full` (whole reference), `changelog --reference` |
| **super-admin** | `users`, `whitelist {list,add,remove}`, `errors {list,view,resolve,unresolve,delete,stats}` |

**Long bodies** (`--description`, `--body`) accept three forms: a literal string,
`-` to read stdin, or a paired `--*-file FILE`.

**Exit codes** (stable — branch on them in scripts/agents):
`0` ok · `1` generic · `2` usage · `3` auth (401 / not configured) · `4`
permission (403) · `5` not-found (404) · `6` validation (400/422) · `7`
user-aborted · `8` client too old (below the API's minimum version).

---

## 9. Rules & guarantees

- **Address items by `#number`.** There is no separate global id; a `#number` is
  unique per workspace. A leading `#` is accepted by the CLI.
- **Everything tenant-scoped is under `/api/workspaces/{ws}/…`.** There are no
  implicit "active workspace" (legacy) routes.
- **Creates return 201 + the entity; deletes return `{ deleted: true }`.**
- **Move/copy is atomic.** `POST …/move` runs in a single transaction — on any
  error nothing is written to the target and the source is untouched. New
  `#number`s are allocated in the target, labels are matched/created by name, and
  user references not in the target's membership are dropped and reported under
  `adjustments`.
- **Undo covers your recent writes:** `POST /api/undo { count }` (max 10) /
  `bk undo --count N`.
- **Every API response carries breadcrumb + version headers** (in addition to the
  body): `X-BK-Help` (→ `/agent-updator`), `X-BK-Changelog` (→ `/changelog`), and
  `X-BK-CLI-Latest` / `X-BK-CLI-Min` (see §11). They're out-of-band, so ignore
  them freely — but if a call fails unexpectedly, they're your way back.
- **`bk` prints a `hint:` line to stderr when you're stuck** (auth failure, a
  drift-smelling 400/404/422, or an unknown command/flag) pointing you at
  `bk changelog` / `/agent-updator`. It's stderr only; `--json` stdout stays pure.

---

## 10. Warnings & common mistakes

- **Wrong workspace (the #1 mistake).** Pick by `name`/`slug`, never the numeric
  `id`; `active_workspace` is only a default. (§3)
- **Literal `\n` in bodies.** Rich-text fields want **real newlines**. Sending
  the two characters backslash-n stores them verbatim. Build JSON bodies with a
  real encoder — never string concatenation — because embedded urls and Markdown
  like `![](url)` contain `()` and other characters that break hand-built
  JSON/shell strings. Prefer `curl --data @body.json`.
- **Character encoding — especially on Windows.** All API text is **UTF-8** in
  and out. When you pipe content through a shell (a bulk import/export/move), keep
  the environment UTF-8. A non-UTF-8 console — commonly Windows `cmd`/PowerShell
  **without `chcp 65001`** — silently corrupts accents and dashes into mojibake
  (`é`→`Ã©`, `—`→`ΓÇö`) that then gets **stored**. Prefer sending a JSON body
  (unambiguously UTF-8 on the wire) over round-tripping text through a terminal.
- **Paths with spaces or parentheses** in CLI `--file`/body references must be
  angle-bracketed: `[](</abs/my file (2).mp4>)`. Plain Markdown stops the link at
  the first `)`.
- **External media won't embed.** Only files uploaded through `/api/upload`
  render inline; raw `<iframe>` and external urls are stripped/left as plain
  links. Upload media to embed it.
- **Editing a file out of a body does not delete the bytes.** Use the owner
  Storage endpoints to clear orphans. (§6)
- **A `#number` is not a global id.** Don't cache a `#number` from one workspace
  and use it in another.

---

## 11. Versioning & staying up to date

- **REST API version:** `1.1.0` (see `GET /api/openapi.json` → `info.version`).
- **CLI:** latest `1.8.6`, minimum supported `1.8.6`. Every API response carries
  `X-BK-CLI-Latest` (newest published — the CLI prints a soft "update available"
  notice when you're behind) and `X-BK-CLI-Min` (oldest supported — the CLI
  **refuses to run**, exit code `8`, when you're below it). When a server change
  is incompatible with older clients, the minimum is raised, so a stale client
  gets a clear "please upgrade" instead of cryptic 404s.
- **To update the CLI:** `npm install -g @blackcode_sa/bc-issues@latest`.
- **To keep an agent skill current:** read this reference, then the dated
  [changelog](/changelog), and re-check it periodically — new entries are added
  with a timestamp for every change we ship. A short how-to for agents lives at
  **[/agent-updator](/agent-updator)**.

### Discovery endpoints (bookmark these)

| URL | What |
|---|---|
| `GET /api/meta` | Live bootstrap context + the authoritative enum vocabulary. |
| `GET /api/changelog` | This reference + the dated log, as JSON or Markdown. |
| `GET /api/openapi.json` | Full OpenAPI 3.1 spec. |
| `/api/docs` | Human-browsable API reference. |
| `/changelog` | This page. |
| `/agent-updator` | How an agent brings itself/its skill up to date. |
| `/llms.txt` | Machine-readable "how to use this site". |
