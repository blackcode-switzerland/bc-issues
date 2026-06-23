# CLI (`bk`)

The `bk` command-line tool is a Go binary that talks to the blackcode-issues HTTP API. It's the recommended interface for scripts, agents, and anyone who'd rather type than click.

It lives in [`/cli`](../cli) as a standalone Go module — separate from the web app, but using the same API.

---

## Table of contents

1. [Overview](#overview)
2. [Build & install](#build--install)
3. [Project layout](#project-layout)
4. [Authentication](#authentication)
5. [Active workspace](#active-workspace)
6. [Command reference](#command-reference)
7. [Configuration & environment](#configuration--environment)
8. [Output formats](#output-formats)
9. [Exit codes](#exit-codes)
10. [Patterns for agents and scripts](#patterns-for-agents-and-scripts)
11. [Internals](#internals)

---

## Overview

| Property | Value |
|---|---|
| Language | Go (see `go.mod`; currently 1.26) |
| Module | `github.com/blackcode-switzerland/bc-issues/cli` |
| Binary | `bk` |
| Framework | [cobra](https://github.com/spf13/cobra) |
| Auth | Bearer API tokens (same `api_tokens` table the web uses) |
| Default server | `http://localhost:3000` |

The CLI mirrors the web app's capabilities: workspaces, projects, members, issues, comments, attachments, tasks, labels, invitations, an inbox, the activity feed, analytics, undo, and — for super admins — platform-wide administration (members, access whitelist, error logs). Output defaults to a human-readable table; `--json` and `--yaml` produce machine-friendly formats with stable shapes.

A typical session:

```bash
bk login --server https://issues.example.com   # browser-based authorize flow
bk workspace list                               # show your workspaces
bk workspace use acme                           # pick the active workspace
bk project list                                 # show your projects
bk issue create --project 1 --title "Fix login" --priority 2
bk issue list --project 1 --mine
bk issue comment 42 --body "Investigating now"
bk undo --count 1                               # roll back the last operation
```

---

## Build & install

All commands are run from the `cli/` directory.

```bash
make build            # builds ./bk for the host platform
make install          # installs to $GOBIN (default: ~/go/bin)
make all              # cross-compiles every target into dist/
make dist             # `all` plus dist/SHA256SUMS
make test             # go test ./...
make run -- <args>    # development shortcut: `go run ./cmd/bk <args>`
```

A plain `go build` works too:

```bash
cd cli
go build -o bk ./cmd/bk
```

The cross-compile matrix (`make all` / `make dist`) covers `darwin/amd64`, `darwin/arm64`, `linux/amd64`, `linux/arm64`, `windows/amd64`, and `windows/arm64`, emitting `dist/bk-<version>-<os>-<arch>[.exe]`.

Versions are stamped into the binary via `-ldflags` (into the `internal/version` package):

- `version.Version` — `git describe --tags --dirty --always` (or `"dev"`)
- `version.Commit` — short git SHA
- `version.BuildDate` — ISO-8601 UTC at build time

`bk version` prints all three.

---

## Releasing & version management

A release is cut with the repo's release script (from the repo root):

```bash
./devops/release.sh cli            # interactive — prompts for everything
./devops/release.sh cli minor      # or pass the bump to skip the first prompt
```

It is **interactive** and asks three things up front, then shows a plan and a
final "Proceed?" confirm before doing anything irreversible:

1. **Bump** — patch / minor / major / explicit `vX.Y.Z` (skipped if passed as an arg).
2. **Upgrade policy** — *normal* or *forced* (see below).
3. **Deploy web?** — whether to push the web app to production at the end.

On confirm it: preflights (gh/npm/git auth, clean tree, version unused — plus
Vercel auth if deploying web); edits `cli/npm/package.json` + `install.js`
(install.js derives its version from package.json, so they can't drift) **and**
`lib/cli-version.ts`, then makes **one** commit + push for all three; creates and
pushes the `vX.Y.Z` tag; `make dist` cross-compiles (version stamped via
`-ldflags`); publishes the GitHub Release + npm package; and finally deploys web
if you said yes. (One commit, near the start — the tag and the published binary
are built from it, so it can't be deferred to after publish.)

### Upgrade policy: normal vs forced

The "update available" notice and the hard min-version block (see
[Updates](#updates)) are driven by **server** constants in `lib/cli-version.ts`,
which the script now edits for you:

- **normal** → sets `CLI_LATEST_VERSION` to the new version (soft "a new bk version
  is available" notice).
- **forced** → also raises `CLI_MIN_VERSION`, so clients below it are hard-blocked
  with "please upgrade" and exit code `8`. Choose this when a server change is
  incompatible with older CLIs (e.g. a breaking route/field rename).

Because the gate lives in the web app, it only takes effect once the web is
deployed — so if you answer **no** to "Deploy web?", the script reminds you to run
`./devops/release.sh web` later. (`BK_CLI_LATEST` / `BK_CLI_MIN` env vars still
override at runtime without a redeploy.) This keeps the four surfaces in sync per
the contract in `CLAUDE.md` / `AGENTS.md`.

---

## Project layout

```
cli/
├── cmd/bk/main.go            # Entry point; maps APIError → exit codes
├── internal/
│   ├── browser/              # Cross-platform "open URL in browser"
│   ├── client/               # HTTP client + DTO types (client.go, types.go, workspace.go)
│   ├── commands/             # Cobra commands (root + subcommands)
│   ├── config/               # ~/.config/bk/config.json loader
│   └── output/               # table / json / yaml renderer
├── go.mod
├── Makefile
└── README.md
```

Direct dependencies are intentionally minimal: `cobra`, `golang.org/x/term` (for hidden token input), and `gopkg.in/yaml.v3`.

---

## Authentication

There is no `BK_SERVER` or `BK_TOKEN` environment variable. The server URL and token are chosen at login time and stored in the config file. To change servers, log in again with a different `--server`.

### `bk login` — browser flow

```bash
bk login --server https://issues.example.com
```

1. The CLI generates a random 32-byte hex `state` token.
2. It binds a loopback TCP listener at `127.0.0.1:<random ephemeral port>`.
3. It opens this URL in the system browser:
   ```
   {server}/cli/authorize?callback=http://127.0.0.1:{port}/callback&state={hex}&name=cli-{hostname}
   ```
4. You sign in (if needed) and approve. The web app's `/cli/authorize` route mints an API token and redirects the browser to the loopback `callback` with `?token=…&state=…` appended.
5. The CLI's listener accepts the request, validates `state` (exact compare), pulls the token from the query string, serves a small "you can close this tab" page, and shuts the listener down. It waits up to 5 minutes for approval.
6. The CLI validates the token by calling `GET /api/me` with `Authorization: Bearer …`.
7. The token + user info land in the config file (mode `0600`).

If `--server` is omitted, the default is `http://localhost:3000`.

### `bk login --token` — headless flow

For CI or environments without a browser. The CLI reads the token from stdin (hidden if a TTY, plain if piped), then validates it the same way (`GET /api/me`) before saving. Mint a token from **Settings → API Tokens** and paste it:

```bash
echo "$MY_TOKEN" | bk login --token --server https://issues.example.com
```

### `bk logout`

Deletes the local config file. The corresponding token row remains in the database — revoke it explicitly from **Settings → API Tokens** if you want it dead server-side.

### `bk whoami`

Hits `GET /api/me`. Prints the authenticated user's id, email, name, role, and how the auth was resolved (`via`: `session` vs `token`). If the token belongs to a super admin it also prints `super: yes`.

---

## Active workspace

Everything below the workspace level is partitioned by workspace: projects, tasks, issues, labels, members, invitations, activity, analytics. Pick the active workspace once, and the rest of `bk` operates within it.

```bash
bk workspace list                 # workspaces you belong to (active row marked with *)
bk workspace use acme             # set the active workspace by slug or numeric id
bk workspace show                 # details of the active workspace
```

The active workspace (id, slug) is stored in the config file and is also set server-side via `POST /api/me/active-workspace`. Workspace-scoped command groups (`label`, `member`, `invite`) require an active workspace and fail with a clear message if none is set. Workspace API paths accept either the **slug** or the **numeric id**.

### Reading another workspace without switching (`--ws`)

`--ws <slug|id>` is a **global flag** that targets a different workspace for that one command only — it does **not** mutate the active workspace (no config write, no `POST /api/me/active-workspace`). A read should never have side effects:

```bash
bk issue list --ws acme --search "login bug"   # read acme; active workspace unchanged
bk issue view 234 --ws acme                     # view by the #seq shown in the app
```

### Global flags

| Flag | Purpose |
|---|---|
| `--ws <slug\|id>` | Target a workspace for this command only; does not change the active one. |
| `-v`, `--verbose` | Log each HTTP request/response (method, URL, status, body) to stderr. Same as `BK_DEBUG=1`. Use this instead of dropping to `curl` when the CLI's view disagrees with reality. |
| `-o`, `--json`, `--yaml` | Output format (see [Output formats](#output-formats)). |

---

## Command reference

Every read command supports `-o table|json|yaml|yml` (default `table`), plus `--json` / `--yaml` / `--yml` shortcuts. Destructive commands that prompt support `--yes` / `-y` to skip confirmation (and respect `BK_NO_PROMPT=1` and non-TTY stdin).

### Auth / session

| Command | Purpose |
|---|---|
| `bk login [--server URL] [--token]` | Browser flow, or headless `--token` (reads token from stdin). |
| `bk logout` | Clear local config. |
| `bk whoami` | Show current user (id, email, name, role, via). |
| `bk version` | Print version, commit, build date. |

### Workspaces

| Command | Backend call | Notes |
|---|---|---|
| `bk workspace list` | `GET /api/workspaces` | Active row marked with `*`. |
| `bk workspace show [slug\|id]` | `GET /api/workspaces/:ref` | Defaults to the active workspace. |
| `bk workspace create --name N [--use]` | `POST /api/workspaces` | `--use` (default `true`) sets it active after creation. |
| `bk workspace use <slug\|id>` | `GET /api/workspaces/:ref` + `POST /api/me/active-workspace` | Sets the active workspace. |

### Projects

| Command | Backend call | Notes |
|---|---|---|
| `bk project list` | `GET /api/workspaces/:ws/projects` | Returns every project in one response (not paginated). |
| `bk project view <id>` | `GET /api/workspaces/:ws/projects/:id` | |
| `bk project members <id>` | `GET /api/workspaces/:ws/projects/:id/members` | |
| `bk project issues <id> [--status S] [--assignee REF]` | `GET /api/workspaces/:ws/issues?project_id=:id` | Status/assignee filters applied client-side. |
| `bk project tasks <id>` | `GET /api/workspaces/:ws/tasks?project_id=:id` | |
| `bk project create --name N [--description D \| --description-file F] [--file F ...]` | `POST /api/workspaces/:ws/projects` | `--file` uploads + embeds inline (repeatable). |
| `bk project edit <id> [--name] [--description \| --description-file] [--status]` | `PATCH /api/workspaces/:ws/projects/:id` | |
| `bk project delete <id> [--yes] [--cascade \| --detach]` | `DELETE /api/workspaces/:ws/projects/:id?mode=…` | Moves to Trash. `--cascade` bins attached tasks/issues as a group (restores together). `--detach` (default) keeps children active, just unlinked. Prompts to confirm. |
| `bk project add-member <id> --email E [--role owner\|admin\|member\|viewer]` | `POST /api/workspaces/:ws/projects/:id/members` | `--role` defaults to `member`. The user must already be registered. |
| `bk project remove-member <id> --user REF [--yes]` | `DELETE /api/workspaces/:ws/projects/:id/members` | `REF` = id, email, or display name. Prompts to confirm. |

### Issues

> **Issue identifier — the `#number`.** Every issue has a single id: the
> per-workspace **`#number`** shown in the app (e.g. `#234`). Commands take that
> number directly, so `bk issue view 234` and `bk issue view #234` both work.
> There is no separate global id — the API addresses items by this number too.

| Command | Backend call | Notes |
|---|---|---|
| `bk issue list [--project N] [--status S] [--assignee REF ...] [--mine] [--search TEXT]` | `GET /api/workspaces/:ws/issues` | Returns every matching issue in one response (not paginated). `--mine` = assigned to the current user. `--assignee` is repeatable. `--search` is server-side (title/description); status/assignee filters are client-side. Footer shows `showing X of N`. |
| `bk issue view <id>` | `GET /api/workspaces/:ws/issues/:id` | `id` is the `#number` shown in the app (a leading `#` is accepted). |
| `bk issue create --project N --title T [...]` | `POST /api/workspaces/:ws/issues` | Full flag list below. |
| `bk issue edit <id> [...]` | `PATCH /api/workspaces/:ws/issues/:id` | Pass `none`/`null`/`unset`/`clear` to clear a field. |
| `bk issue assign <id> <user> [<user> ...]` | `PATCH /api/workspaces/:ws/issues/:id` | Adds one or more assignees (does not remove existing). |
| `bk issue unassign <id> [<user>]` | `PATCH /api/workspaces/:ws/issues/:id` | Removes a specific assignee, or clears all if no user given. |
| `bk issue delete <id> [--yes]` | `DELETE /api/workspaces/:ws/issues/:id` | Moves to Trash. Prompts to confirm. Restore with `bk trash restore issue:<id>`. |
| `bk issue comment <id> --body "..." \| --body - \| --body-file F [--reply-to C] [--file F ...]` | `POST /api/workspaces/:ws/issues/:id/comments` | Body or `--file` required. `--reply-to` threads under comment id C. `--file` uploads + embeds inline. |
| `bk issue comments <id>` | `GET /api/workspaces/:ws/issues/:id/comments` | |
| `bk issue activity <id>` | `GET /api/workspaces/:ws/issues/:id/activity` | Merged comments + change log. |
| `bk issue attach <id> --file F` | `POST /api/upload` then `POST /api/workspaces/:ws/issues/:id/attachments` | Adds to the **attachments list** (sidebar), not the body. To embed inline use `--file` on `create`/`comment`. |
| `bk issue attachments <id>` | `GET /api/workspaces/:ws/issues/:id/attachments` | |
| `bk issue detach <id> <attachment-id> [--yes]` | `DELETE /api/workspaces/:ws/issues/:id/attachments/:attachmentId` | Prompts to confirm. |

**`issue create` flags**:

```
--project N             (required)
--title "..."           (required)
--description D | -      literal, or "-" for stdin
--description-file F     read description from file
--priority 1-5          1 = urgent
--status S              backlog | todo | in_progress | done | cancelled
--assignee REF [...]    id, email, display name, or "me" — repeatable for multiple assignees
--task N           task id
--start-date YYYY-MM-DD
--due-date YYYY-MM-DD
--label NAME            label name; repeatable — existing labels matched, unknown ones created on the fly
--attach FILE           adds FILE to the issue's attachments list (sidebar), separate from the body
--file FILE             uploads FILE and embeds it inline in the description (repeatable)
```

> `--status` is free-form on the CLI side and validated server-side. The canonical issue statuses are `backlog`, `todo`, `in_progress`, `done`, and `cancelled`.

#### Embedding files in descriptions & comments

There are three ways to put a file **inline in the body** (image preview,
video/audio player, or download card — the same result as web drag-and-drop).
All work because the server rewrites uploaded-file urls into rich-text nodes.

1. **`--file FILE` (repeatable)** — uploads and **appends** the file to the body.
   Best when placement at the end is fine. Available on `issue/task/project
   create` and `issue comment`.

2. **Reference a local file path in the body** — for a *structured* doc (files
   under specific headings), just reference local paths in `--description` /
   `--description-file` (and `--body`); the CLI uploads each and rewrites it in
   place:

   ```md
   ## Demo video
   ![](./out.png)                         <!-- image -->
   [](<~/clips/screen recording (1).mov>) <!-- see angle-bracket note below -->
   ```

   A reference is only uploaded when the target has no `http(s)://` scheme and
   resolves to a real file on disk; everything else is left untouched. Empty
   link text is auto-filled from the filename. **No sidebar record is created.**

   > **Paths with spaces or parentheses must be angle-bracketed**: `[](</abs/my
   > file (2).mp4>)`. Plain Markdown stops the destination at the first `)`, so
   > `[](/a/foo(1).mp3)` would silently truncate.

3. **`bk upload FILE...`** — uploads and prints just the url(s) (no sidebar
   record), for scripting: `URL=$(bk upload ./x.png --json | jq -r '.[0].url')`,
   then drop `![](URL)` into the body yourself.

> **`--file` vs `bk issue attach`.** `--file` (and the methods above) embed in the
> **body**. `bk issue attach` is different — it's issue-only and adds the file to
> the separate **attachments list** (sidebar), not the body.

**`issue edit` flags**: `--title`, `--description` / `--description-file`, `--status`, `--priority`, `--assignee` (repeatable, replaces all assignees; `none` clears all), `--task`, `--start-date`, `--due-date`. Only flags you actually pass are sent; nullable fields (`--task`, `--start-date`, `--due-date`) accept the `none` sentinel to clear them. `--assignee none` sends an empty array, removing all assignees.

### Tasks

`bk tasks` is an alias for `bk task`.

| Command | Backend call |
|---|---|
| `bk task list [--project N]` | `GET /api/workspaces/:ws/tasks[?project_id=N]` |
| `bk task view <id> [--include-issues]` | `GET /api/workspaces/:ws/tasks/:id[?includeIssues=true]` |
| `bk task create --project N --name M [--description D \| --description-file F] [--due-date YYYY-MM-DD] [--file F ...]` | `POST /api/workspaces/:ws/tasks` | `--file` uploads + embeds inline (repeatable). |
| `bk task edit <id> [--name] [--description \| --description-file] [--due-date <YYYY-MM-DD\|none>]` | `PATCH /api/workspaces/:ws/tasks/:id` |
| `bk task delete <id> [--yes] [--cascade \| --detach]` | `DELETE /api/workspaces/:ws/tasks/:id?mode=…` | Moves to Trash. `--cascade` bins attached issues as a group. `--detach` (default) keeps issues active. |

### Trash (recycle bin, workspace-scoped)

All deletes (issues, projects, tasks) are soft — rows move to a per-workspace Trash rather than being destroyed. Use `bk trash` to inspect and manage the bin.

| Command | Backend call | Notes |
|---|---|---|
| `bk trash list [--type issue\|project\|task]` | `GET /api/workspaces/:ws/trash` | Shows binned items grouped by deletion batch. |
| `bk trash restore <type:id> [<type:id> …]` | `POST /api/workspaces/:ws/trash/restore` | e.g. `bk trash restore issue:42 project:3`. Detects and reports conflicts. |
| `bk trash restore --batch <id> [--restore-parents\|--standalone]` | same | Restore a whole cascade-delete group at once. |
| `bk trash purge <type:id> [--yes]` | `DELETE /api/workspaces/:ws/trash/purge` | Permanent hard-delete. **Owner only.** |
| `bk trash purge --batch <id> [--yes]` | same | Purge a whole batch. |
| `bk trash empty [--yes]` | `POST /api/workspaces/:ws/trash/empty` | Hard-delete everything in the bin. **Owner only.** |

**Automatic file cleanup.** When you permanently delete a trashed item (`bk trash
purge` / `bk trash empty`), any files embedded in that content are automatically
removed from storage once nothing else in the workspace references them — so
storage is freed without owner action. (Same for `bk issue delete-comment`.) See
[Storage](#storage-workspace-scoped-owner-only).

Restore conflict flags: `--restore-parents` (also restore the parent when a child's parent is still binned) and `--standalone` (restore the child with the parent link cleared). If neither is passed and conflicts exist, the command reports them and exits non-zero.

### Labels (workspace-scoped)

Operate on the active workspace; paths are `…/workspaces/{ws}/…`.

| Command | Backend call | Notes |
|---|---|---|
| `bk label list` | `GET /api/workspaces/:ws/labels` | |
| `bk label view <id>` | `GET /api/workspaces/:ws/labels/:id` | |
| `bk label create --name N [--color #rrggbb] [--description D]` | `POST /api/workspaces/:ws/labels` | `--color` defaults to `#6b7280`. |
| `bk label delete <id>` | `DELETE /api/workspaces/:ws/labels/:id` | Removes it from all issues. |
| `bk label attach <issue-id> <label-id>` | `POST /api/workspaces/:ws/issues/:issue/labels` | |
| `bk label detach <issue-id> <label-id>` | `DELETE /api/workspaces/:ws/issues/:issue/labels/:label` | |

### Members (workspace-scoped)

| Command | Backend call | Notes |
|---|---|---|
| `bk member list` | `GET /api/workspaces/:ws/members` | |
| `bk member remove <user-id>` | `DELETE /api/workspaces/:ws/members/:user` | Owner only. |
| `bk member leave` | `POST /api/workspaces/:ws/leave` | Not allowed for the owner. |

### Invitations (workspace-scoped)

| Command | Backend call | Notes |
|---|---|---|
| `bk invite send <email>` | `POST /api/workspaces/:ws/invitations` | If the invitee has no account, prints a shareable invite link. |
| `bk invite list [--all]` | `GET /api/workspaces/:ws/invitations[?all=true]` | Owner only. `--all` includes accepted/revoked/expired. |
| `bk invite revoke <id>` | `DELETE /api/workspaces/:ws/invitations/:id` | |
| `bk invite accept <token>` | `POST /api/invitations/accept` | Accept by token. |
| `bk invite decline <token>` | `POST /api/invitations/decline` | Decline by token. |
| `bk invite pending` | `GET /api/me/pending-invitations` | Invitations pending for your email, across workspaces. |
| `bk invite candidates` | `GET /api/workspaces/:ws/invite-candidates` | Owner only. People you can invite without retyping an email; status column shows `member`/`invited`/`—`. |

### Inbox

Per-user notifications (invitations, mentions, assignments, status changes).

| Command | Backend call | Notes |
|---|---|---|
| `bk inbox list [--unread]` | `GET /api/me/inbox` | Prints an unread count to stderr. `--unread` shows only unread messages. |
| `bk inbox read [id ...] \| --all` | `POST /api/me/inbox/mark-read` | Provide message ids, or `--all` to mark every unread message read. |
| `bk inbox archive <id> [id ...]` | `POST /api/me/inbox/archive` | At least one id is required. |

### Users

`bk users` is an alias for `bk user`.

| Command | Backend call | Notes |
|---|---|---|
| `bk user list` | `GET /api/users` | |
| `bk user view <id\|email>` | `GET /api/users` + client-side filter | No single-user endpoint; the CLI filters the list. |

### Files

| Command | Backend call | Notes |
|---|---|---|
| `bk upload <file> [<file> ...]` | `POST /api/upload` | Uploads file(s) (max 100MB), prints the url(s). Table mode prints bare urls (pipeable); `--json` returns `[{url,filename,size,contentType}]`. Does **not** create a sidebar attachment. See [Embedding files](#embedding-files-in-descriptions--comments). |

### Storage (workspace-scoped, owner only)

Every file uploaded into the workspace is tracked. Removing a file from a
description/comment does **not** delete the stored bytes (so undo and
trash-restore stay safe) — use these to review usage and delete unused files.

| Command | Backend call | Notes |
|---|---|---|
| `bk storage list` | `GET /api/workspaces/:ws/storage` | Files with `REFS` (how many things reference each, incl. trashed items) and total usage. `REFS 0` = orphan. `--json` includes the full reference breakdown + `usage_bytes`/`limit_bytes`. |
| `bk storage rm <id> [--yes]` | `DELETE /api/workspaces/:ws/storage/:id` | Permanently delete a file by id. **Refused (409 `file_in_use`) if anything still references it** — remove those references or empty the Trash first. Irreversible. |
| `bk storage attachments` | `GET /api/workspaces/:ws/attachments` | The workspace-wide attachments table (every `bk issue attach` row), joined to its issue + uploader. |

### Activity / analytics / undo

| Command | Backend call | Notes |
|---|---|---|
| `bk activity [--limit N] [--cursor N]` | `GET /api/workspaces/:ws/activity` | Active-workspace change feed (keyset-paginated). `--limit` defaults to 50; `--cursor` is the last event id seen, echoed as `next page: --cursor=N` on stderr. |
| `bk analytics [flags]` | `GET /api/workspaces/:ws/analytics` | Workspace analytics with full web-dashboard parity (see below). `--ws <slug\|id>` targets another workspace via the path. Any member; not admin-only. |
| `bk undo [--count N] [--yes]` | `POST /api/undo` | Rolls back your last N operations (clamped to 1–10). Prompts to confirm. |

**`bk analytics` flags** — all optional; defaults to the active workspace,
workspace scope, last-30-days window, daily buckets:

| Flag | Meaning |
|---|---|
| `--view workspace\|project\|task\|member` | Analytics scope. |
| `--id N` | Target id — required for `project` / `task` / `member`. |
| `--ws <slug\|id>` | Target a workspace without changing the active one. |
| `--from`, `--to` | Window bounds (`YYYY-MM-DD` or ISO). Omit for all-time. |
| `--interval day\|week` | Time-series bucket width. |
| `--status`, `--priority`, `--label`, `--assignee` | Faceted filters; repeatable or comma-separated, applied to every metric. |

Default output is a readable summary (KPIs + by-status / by-priority /
by-assignee); `--json` / `--yaml` emit the **full** payload (trends, all series,
histograms, burndown). Examples:

```bash
bk analytics                                              # active workspace, 30d
bk analytics --view project --id 12 --interval week --json
bk analytics --status todo,in_progress --priority 1 --priority 2
bk analytics --ws acme --view member --id 5 --from 2026-01-01
```

### Super admin (platform-wide)

The `bk super-admin` group (alias `admin`) mirrors the web Super Admin section.
Every command requires a **super-admin token** — an account whose email is in
the server's `SUPER_ADMINS` env var. Any other token is rejected by the API with
`403` → exit code 4; there is no client-side bypass. These actions are **not**
workspace-scoped — the whitelist and error log are platform-wide.

| Command | Backend call | Notes |
|---|---|---|
| `bk super-admin users` | `GET /api/super-admin/users` | Every member on the platform with their workspace count + last login. |
| `bk super-admin whitelist list` | `GET /api/super-admin/whitelist` | Allowed domains and emails. |
| `bk super-admin whitelist add --type domain\|email --value V` | `POST /api/super-admin/whitelist` | `domain` allows everyone on it; `email` allows one address. Idempotent. |
| `bk super-admin whitelist remove <id> [--yes]` | `DELETE /api/super-admin/whitelist/{id}` | Prompts to confirm. |
| `bk super-admin errors list [flags]` | `GET /api/super-admin/errors` | Filters: `--level`, `--status open\|resolved`, `--from`/`--to`, `--limit`/`--cursor`, `--stats`. Newest first. |
| `bk super-admin errors view <id>` | `GET /api/super-admin/errors/{id}` | Full detail incl. stack + context. |
| `bk super-admin errors resolve <id>` | `PATCH /api/super-admin/errors/{id}` | Sets `resolved: true`. |
| `bk super-admin errors unresolve <id>` | `PATCH /api/super-admin/errors/{id}` | Sets `resolved: false`. |
| `bk super-admin errors delete <id> [id ...] [--yes]` | `DELETE /api/super-admin/errors/{id}` (single) or `DELETE /api/super-admin/errors` `{ids}` (bulk) | Permanent. Prompts to confirm. |
| `bk super-admin errors stats` | `GET /api/super-admin/errors?stats=1` | Total / open / resolved counts. |

```bash
bk super-admin whitelist add --type domain --value blackcode.ch
bk super-admin users --json | jq '.[] | select(.workspace_count == 0)'
bk super-admin errors list --status open --limit 20
bk super-admin errors view 482
bk super-admin errors resolve 482
```

`bk whoami` prints `super: yes` when the active token has super-admin access.

### Body / description input convention

For any `--description` / `--body` flag, three forms work, and the `*-file` variant takes precedence:

```bash
--description "literal text"      # string literal
--description -                   # read from stdin
--description-file path/to.md     # read from file
```

**Format:** description/body content may be **Markdown or HTML** — the server
stores it as sanitized HTML. Send **real newlines** (use `--description-file` or
`-`/stdin for multi-line); don't hand-build a JSON body with the literal
characters `\n`, or the line breaks won't render.

### Nullable field convention

For `edit` commands on nullable fields (`--assignee`, `--task`, `--start-date`, `--due-date`; `--due-date` on tasks):

- Omit the flag → leave it unchanged.
- Pass `none`, `null`, `unset`, or `clear` (case-insensitive) → explicitly null it.

```bash
bk issue edit 42 --task none --due-date 2026-06-30
```

### User-reference convention

Wherever a command takes a "user reference" (`--assignee`, `bk issue assign`, `bk project remove-member --user`, etc.), the CLI accepts:

- A numeric id (`42`)
- An email (anything containing `@`, e.g. `alice@example.com`)
- A display name (`"Alice Andrews"`)
- The literal string `me`

Non-numeric refs trigger a `GET /api/users` lookup the first time they're resolved. (Workspace `member remove` takes a numeric **user id** only.)

---

## Configuration & environment

### Config file

`~/.config/bk/config.json` (mode `0600`, directory mode `0700`):

```json
{
  "server": "http://localhost:3000",
  "token":  "…",
  "user_id": 7,
  "email":  "alice@example.com",
  "active_workspace_id": 3,
  "active_workspace_slug": "acme",
  "last_update_check": 1718668800
}
```

`last_update_check` is a unix timestamp the CLI writes to throttle the soft update notice to once per 24h (see [Updates](#updates)).

Override the directory with `BK_CONFIG_DIR` (the file is always `config.json` inside it). The token and server live here only — there are no `BK_SERVER` / `BK_TOKEN` environment variables.

### Environment variables

| Variable | Effect |
|---|---|
| `BK_CONFIG_DIR` | Override the config directory (default `~/.config/bk`). |
| `BK_NO_PROMPT=1` | Skip all interactive confirmations (recommended for CI / agents). |

### Server selection

`bk login --server https://issues.example.com` writes the URL into config and all subsequent commands use it. To switch servers later, log in again pointing at the new URL.

---

## Output formats

### Table (default)

`text/tabwriter` aligned columns. Headers vary per command; for example `bk project list`:

```
ID    NAME            STATUS    ROLE    ISSUES (OPEN/TOTAL)
1     Onboarding      active    owner   3/12
2     Trinity Spec    active    member  0/4
```

### JSON (`--json` or `-o json`)

Pretty-printed with 2-space indent. Paginated responses are wrapped:

```json
{
  "data":  [ … ],
  "total": 128
}
```

### YAML (`--yaml` / `--yml` / `-o yaml`)

Same shape, YAML-formatted (2-space indent).

> Conflicting format flags (e.g. `--json --yaml`) are rejected. Pick one of `--output`, `--json`, `--yaml`/`--yml`.

### Pagination

The main list commands (`bk issue list`, `bk project list`, `bk task list`) are **not paginated** — they return every matching item in one response (`bk issue list` adds a `total` count). Only the keyset-paginated feeds accept `--limit` / `--cursor`: `bk activity`, `bk trash list`, and `bk super-admin errors list`. Their wire shape is `{ "data": [...], "next_cursor": <id|null> }`, and in **table** mode the CLI prints `next page: --cursor=<id>` to stderr when more rows remain (`… --json | jq '.next_cursor'`).

---

## Exit codes

Stable for scripting. The mapping happens in `cmd/bk/main.go` by inspecting the `APIError.Status` returned from the HTTP client (and a couple of message heuristics):

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Generic / runtime error |
| 2 | Bad usage (missing required flag, invalid id) |
| 3 | Not authenticated (401, or no config) |
| 4 | Permission denied (403) |
| 5 | Not found (404) |
| 6 | Validation error (400 / 422) |
| 7 | User aborted (declined a confirm prompt) |
| 8 | Client outdated — running version is below the API's minimum supported version; upgrade required |

---

## Updates

The API sends two headers on **every** response, and the CLI acts on them:

- `X-BK-CLI-Latest` — the newest published CLI version.
- `X-BK-CLI-Min` — the oldest version the API still supports.

**Soft notice.** When the running version is older than `X-BK-CLI-Latest`, the CLI prints `A new bk version (X) is available — upgrade: npm i -g @blackcode_sa/bc-issues@latest` to **stderr** after the command finishes. It's throttled to once per 24 hours via the `last_update_check` field in the config file, and never written to stdout (so it can't corrupt `--json` output).

**Hard floor.** When the running version is below `X-BK-CLI-Min`, every request fails fast: the CLI prints `Your bk version (X) is no longer supported. Upgrade: …` to stderr and exits with code **8**. Dev / unparsable versions (`dev`, `(devel)`, etc.) are never blocked or nagged.

---

## Patterns for agents and scripts

### Non-interactive defaults

```bash
export BK_NO_PROMPT=1
bk issue delete 42      # no confirmation prompt
```

Confirmation is also auto-skipped when stdin is not a TTY (e.g. piped input), and per-command with `--yes`/`-y`.

### Pipe-friendly JSON

```bash
bk issue list --project 1 --status todo --json \
  | jq -r '.data[].id' \
  | xargs -n1 -I{} bk issue edit {} --status in_progress --assignee me
```

### Recover from a misstep

```bash
bk undo --count 1 --yes
```

### Authenticate headlessly

```bash
echo "$MY_TOKEN" | bk login --token --server https://issues.example.com
```

### Inline error inspection

```bash
bk issue view 999999 || echo "exit code: $?"
# exit code: 5   (not found)
```

### Robust scripting checklist

- Set `BK_NO_PROMPT=1`.
- Pick an active workspace first (`bk workspace use …`) before workspace-scoped commands.
- Always use `--json` for parsing; the table format is for humans.
- Branch on exit codes, not stderr text.
- For long-running scripts, regenerate the token periodically (the CLI doesn't refresh automatically).

---

## Internals

### HTTP client (`internal/client/`)

Built around a small `Client` struct:

- Constructor: `client.New(baseURL, token) *Client` (trailing slash on the base URL is trimmed).
- Verb helpers: `get`, `postJSON`, `patchJSON`, `deleteJSON`, plus `UploadFile` (multipart) and `AttachToIssue`.
- Common headers on every request: `Authorization: Bearer …` (when a token is set), `Accept: application/json`, `User-Agent: bk-cli/<version>` (the stamped `internal/version.Version`).
- 30-second timeout.
- Non-2xx responses decode into `APIError { Status, ErrorMsg, Suggestion, Details }`; the `main.go` translator maps `Status` to an exit code.
- Every response's `X-BK-CLI-Latest` / `X-BK-CLI-Min` headers are recorded into package vars `client.LatestSeen` / `client.MinSeen`. If the running version is below `MinSeen`, the request returns `*client.OutdatedError` (exit code 8). `main.go` reads `LatestSeen` after `Execute()` to print the throttled soft-update notice. See [Updates](#updates).

DTO types live in `internal/client/types.go` (`Me`, `User`, `Project`, `Issue`, `Task`, `Comment`, `Attachment`, `ProjectMember`, the page wrappers, etc.) and `internal/client/workspace.go` (`Workspace`, `WorkspaceMember`, `WorkspaceInvitation`, `InboxMessage`, `Label`, and their request/response shapes). Some endpoints use the legacy non-workspace paths (`/api/workspaces/:ws/projects`, `/api/workspaces/:ws/issues`, `/api/workspaces/:ws/tasks`) while the newer workspace-scoped features (labels, members, invitations) use `/api/workspaces/{slug|id}/…`.

### Auth flow (`internal/commands/login.go`)

The state machine:

1. Generate `state` (`crypto/rand`, hex-encoded).
2. Bind `127.0.0.1:0` (kernel picks the port).
3. Open the browser to `{server}/cli/authorize?callback=…&state=…&name=cli-<hostname>`.
4. The loopback server handles **one** request to `/callback`:
   - Validates `state` (exact match).
   - Reads `token` from the query string.
   - Serves a small "you can close this window" HTML page.
   - Signals completion; the listener shuts down (5-minute overall timeout).
5. Validate the token (`GET /api/me`).
6. Save config.

### Helpers (`internal/commands/util.go`)

| Function | Purpose |
|---|---|
| `Confirm(prompt, yes)` | Interactive y/N; returns true if `--yes`, `BK_NO_PROMPT=1`, or stdin is not a TTY. |
| `ReadBody(literal, fromFile)` | Resolves `--body-file FILE` / `--body -` / `--body "..."` into a string. |
| `ResolveUserRef(c, cfg, ref)` | Turns an email/name/id/"me" into a numeric user id (calls `/api/users` if needed). |
| `IntOrNullJSON(ref, c, cfg)` | Encodes a user ref to JSON `null` or an int; supports `none`/`null`/`unset`/`clear`. |
| `PlainIntOrNullJSON(ref)` | Same, but expects a plain integer (used for task ids). |
| `StringOrNullJSON(ref)` | Encodes a JSON string, `null` for the clear keywords, or omits when empty (used for dates). |

### Output (`internal/output/`)

- `RegisterFlags(cmd)` attaches `-o/--output`, `--json`, `--yaml`, `--yml`.
- `Resolve(cmd)` reads them, rejects conflicts, and returns `FormatTable | FormatJSON | FormatYAML`.
- `Render(format, data, tableFn)` dispatches: JSON via `json.MarshalIndent` (2 spaces), YAML via `yaml.Encoder` (2-space indent), or table via the command-provided `tableFn(w)`.
- `Tabwriter(w)` returns the shared `tabwriter.Writer` configuration.

---

## See also

- [Backend doc](./backend.md) — the HTTP API the CLI calls.
- [Frontend doc](./frontend.md) — the web side of the same data.
- [`cli/README.md`](../cli/README.md) — the in-repo CLI quick-reference companion to this doc.
