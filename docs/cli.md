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
| Module | `github.com/mustneerar7/blackcode-issues/cli` |
| Binary | `bk` |
| Framework | [cobra](https://github.com/spf13/cobra) |
| Auth | Bearer API tokens (same `api_tokens` table the web uses) |
| Default server | `http://localhost:3000` |

The CLI mirrors the web app's capabilities: workspaces, projects, members, issues, comments, attachments, milestones, labels, invitations, an inbox, the activity feed, analytics, and undo. Output defaults to a human-readable table; `--json` and `--yaml` produce machine-friendly formats with stable shapes.

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

Versions are stamped into the binary via `-ldflags`:

- `commands.Version` — `git describe --tags --dirty --always` (or `"dev"`)
- `commands.Commit` — short git SHA
- `commands.BuildDate` — ISO-8601 UTC at build time

`bk version` prints all three.

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
6. The CLI validates the token by calling `GET /api/users/me` with `Authorization: Bearer …`.
7. The token + user info land in the config file (mode `0600`).

If `--server` is omitted, the default is `http://localhost:3000`.

### `bk login --token` — headless flow

For CI or environments without a browser. The CLI reads the token from stdin (hidden if a TTY, plain if piped), then validates it the same way (`GET /api/users/me`) before saving. Mint a token from **Settings → API Tokens** and paste it:

```bash
echo "$MY_TOKEN" | bk login --token --server https://issues.example.com
```

### `bk logout`

Deletes the local config file. The corresponding token row remains in the database — revoke it explicitly from **Settings → API Tokens** if you want it dead server-side.

### `bk whoami`

Hits `GET /api/users/me`. Prints the authenticated user's id, email, name, role, and how the auth was resolved (`via`: `session` vs `token`).

---

## Active workspace

Everything below the workspace level is partitioned by workspace: projects, milestones, issues, labels, members, invitations, activity, analytics. Pick the active workspace once, and the rest of `bk` operates within it.

```bash
bk workspace list                 # workspaces you belong to (active row marked with *)
bk workspace use acme             # set the active workspace by slug or numeric id
bk workspace show                 # details of the active workspace
```

The active workspace (id, slug, key) is stored in the config file and is also set server-side via `POST /api/me/active-workspace`. Workspace-scoped command groups (`label`, `member`, `invite`) require an active workspace and fail with a clear message if none is set. Workspace API paths accept either the **slug** or the **numeric id**.

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
| `bk workspace list` | `GET /api/me/workspaces` | Active row marked with `*`. |
| `bk workspace show [slug\|id]` | `GET /api/workspaces/:ref` | Defaults to the active workspace. |
| `bk workspace create --name N [--use]` | `POST /api/workspaces` | `--use` (default `true`) sets it active after creation. |
| `bk workspace use <slug\|id>` | `GET /api/workspaces/:ref` + `POST /api/me/active-workspace` | Sets the active workspace. |

### Projects

| Command | Backend call | Notes |
|---|---|---|
| `bk project list [--limit N] [--cursor ID]` | `GET /api/projects` | Cursor-paged when `--limit`/`--cursor` set; otherwise a flat list. |
| `bk project view <id>` | `GET /api/projects/:id` | |
| `bk project members <id>` | `GET /api/projects/:id/members` | |
| `bk project issues <id> [--status S] [--assignee REF] [--limit N] [--cursor ID]` | `GET /api/issues?project_id=:id` | Status/assignee filters applied client-side. |
| `bk project milestones <id>` | `GET /api/milestones?project_id=:id` | |
| `bk project create --name N [--description D \| --description-file F]` | `POST /api/projects` | |
| `bk project edit <id> [--name] [--description \| --description-file] [--status]` | `PATCH /api/projects/:id` | |
| `bk project delete <id> [--yes] [--cascade \| --detach]` | `DELETE /api/workspaces/:ws/projects/:id?mode=…` | Moves to Trash. `--cascade` bins attached milestones/issues as a group (restores together). `--detach` (default) keeps children active, just unlinked. Prompts to confirm. |
| `bk project add-member <id> --email E [--role owner\|admin\|member\|viewer]` | `POST /api/projects/:id/members` | `--role` defaults to `member`. The user must already be registered. |
| `bk project remove-member <id> --user REF [--yes]` | `DELETE /api/projects/:id/members` | `REF` = id, email, or display name. Prompts to confirm. |

### Issues

| Command | Backend call | Notes |
|---|---|---|
| `bk issue list [--project N] [--status S] [--assignee REF \| --mine] [--limit N] [--cursor ID]` | `GET /api/issues` | `--mine` = assigned to the current user. Status/assignee filters are client-side. |
| `bk issue view <id>` | `GET /api/issues/:id` | |
| `bk issue create --project N --title T [...]` | `POST /api/issues` | Full flag list below. |
| `bk issue edit <id> [...]` | `PATCH /api/issues/:id` | Pass `none`/`null`/`unset`/`clear` to null a field. |
| `bk issue assign <id> <user>` | `PATCH /api/issues/:id` | Shortcut for setting the assignee. |
| `bk issue unassign <id>` | `PATCH /api/issues/:id` | Clears the assignee. |
| `bk issue delete <id> [--yes]` | `DELETE /api/workspaces/:ws/issues/:id` | Moves to Trash. Prompts to confirm. Restore with `bk trash restore issue:<id>`. |
| `bk issue comment <id> --body "..." \| --body - \| --body-file F` | `POST /api/issues/:id/comments` | Body must be non-empty. |
| `bk issue comments <id>` | `GET /api/issues/:id/comments` | |
| `bk issue activity <id>` | `GET /api/issues/:id/activity` | Merged comments + change log. |
| `bk issue attach <id> --file F` | `POST /api/upload` then `POST /api/issues/:id/attachments` | Two-step upload + attach. |
| `bk issue attachments <id>` | `GET /api/issues/:id/attachments` | |
| `bk issue detach <issue-id> <attachment-id> [--yes]` | `DELETE /api/issues/:id/attachments?attachmentId=N` | Prompts to confirm. |

**`issue create` flags**:

```
--project N             (required)
--title "..."           (required)
--description D | -      literal, or "-" for stdin
--description-file F     read description from file
--priority 1-5          1 = urgent
--status S              backlog | todo | in_progress | done | cancelled
--assignee REF          id, email, display name, or "me"
--milestone N           milestone id
--start-date YYYY-MM-DD
--due-date YYYY-MM-DD
--attach FILE           uploads + attaches in one step after the issue is created
```

> `--status` is free-form on the CLI side and validated server-side. The canonical issue statuses are `backlog`, `todo`, `in_progress`, `done`, and `cancelled`.

**`issue edit` flags**: `--title`, `--description` / `--description-file`, `--status`, `--priority`, `--assignee`, `--milestone`, `--start-date`, `--due-date`. Only flags you actually pass are sent; nullable fields (`--assignee`, `--milestone`, `--start-date`, `--due-date`) accept the `none` sentinel to clear them.

### Milestones

`bk milestones` is an alias for `bk milestone`.

| Command | Backend call |
|---|---|
| `bk milestone list [--project N]` | `GET /api/milestones[?project_id=N]` |
| `bk milestone view <id> [--include-issues]` | `GET /api/milestones/:id[?includeIssues=true]` |
| `bk milestone create --project N --name M [--description D \| --description-file F] [--due-date YYYY-MM-DD]` | `POST /api/milestones` |
| `bk milestone edit <id> [--name] [--description \| --description-file] [--due-date <YYYY-MM-DD\|none>]` | `PATCH /api/milestones/:id` |
| `bk milestone delete <id> [--yes] [--cascade \| --detach]` | `DELETE /api/workspaces/:ws/milestones/:id?mode=…` | Moves to Trash. `--cascade` bins attached issues as a group. `--detach` (default) keeps issues active. |

### Trash (recycle bin, workspace-scoped)

All deletes (issues, projects, milestones) are soft — rows move to a per-workspace Trash rather than being destroyed. Use `bk trash` to inspect and manage the bin.

| Command | Backend call | Notes |
|---|---|---|
| `bk trash list [--type issue\|project\|milestone]` | `GET /api/workspaces/:ws/trash` | Shows binned items grouped by deletion batch. |
| `bk trash restore <type:id> [<type:id> …]` | `POST /api/workspaces/:ws/trash/restore` | e.g. `bk trash restore issue:42 project:3`. Detects and reports conflicts. |
| `bk trash restore --batch <id> [--restore-parents\|--standalone]` | same | Restore a whole cascade-delete group at once. |
| `bk trash purge <type:id> [--yes]` | `DELETE /api/workspaces/:ws/trash/purge` | Permanent hard-delete. **Owner only.** |
| `bk trash purge --batch <id> [--yes]` | same | Purge a whole batch. |
| `bk trash empty [--yes]` | `POST /api/workspaces/:ws/trash/empty` | Hard-delete everything in the bin. **Owner only.** |

Restore conflict flags: `--restore-parents` (also restore the parent when a child's parent is still binned) and `--standalone` (restore the child with the parent link cleared). If neither is passed and conflicts exist, the command reports them and exits non-zero.

### Labels (workspace-scoped)

Operate on the active workspace; paths are `…/workspaces/{ws}/…`.

| Command | Backend call | Notes |
|---|---|---|
| `bk label list` | `GET /api/workspaces/:ws/labels` | |
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

### Activity / analytics / undo

| Command | Backend call | Notes |
|---|---|---|
| `bk activity [--limit N] [--offset N]` | `GET /api/activity` | Global change feed. `--limit` defaults to 50. |
| `bk analytics` | `GET /api/analytics` | Admin-only; emitted as JSON regardless of `-o`. |
| `bk undo [--count N] [--yes]` | `POST /api/undo` | Rolls back your last N operations (clamped to 1–10). Prompts to confirm. |

### Body / description input convention

For any `--description` / `--body` flag, three forms work, and the `*-file` variant takes precedence:

```bash
--description "literal text"      # string literal
--description -                   # read from stdin
--description-file path/to.md     # read from file
```

### Nullable field convention

For `edit` commands on nullable fields (`--assignee`, `--milestone`, `--start-date`, `--due-date`; `--due-date` on milestones):

- Omit the flag → leave it unchanged.
- Pass `none`, `null`, `unset`, or `clear` (case-insensitive) → explicitly null it.

```bash
bk issue edit 42 --milestone none --due-date 2026-06-30
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
  "active_workspace_key": "ACME"
}
```

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
  "data":        [ … ],
  "next_cursor": 42
}
```

### YAML (`--yaml` / `--yml` / `-o yaml`)

Same shape, YAML-formatted (2-space indent).

> Conflicting format flags (e.g. `--json --yaml`) are rejected. Pick one of `--output`, `--json`, `--yaml`/`--yml`.

### Pagination

`bk issue list` and `bk project list` accept `--limit` / `--cursor`. The wire shape is `{ "data": [...], "next_cursor": <id|null> }`. In **table** mode, when a `next_cursor` is present, the CLI prints `next page: --cursor=42` to stderr — handy for scripting (`bk issue list --json | jq '.next_cursor'`). Without `--limit`/`--cursor`, a flat array is returned instead of the envelope.

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
- Common headers on every request: `Authorization: Bearer …` (when a token is set), `Accept: application/json`, `User-Agent: bk-cli/0.1`.
- 30-second timeout.
- Non-2xx responses decode into `APIError { Status, ErrorMsg, Suggestion, Details }`; the `main.go` translator maps `Status` to an exit code.

DTO types live in `internal/client/types.go` (`Me`, `User`, `Project`, `Issue`, `Milestone`, `Comment`, `Attachment`, `ProjectMember`, the page wrappers, etc.) and `internal/client/workspace.go` (`Workspace`, `WorkspaceMember`, `WorkspaceInvitation`, `InboxMessage`, `Label`, and their request/response shapes). Some endpoints use the legacy non-workspace paths (`/api/projects`, `/api/issues`, `/api/milestones`) while the newer workspace-scoped features (labels, members, invitations) use `/api/workspaces/{slug|id}/…`.

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
5. Validate the token (`GET /api/users/me`).
6. Save config.

### Helpers (`internal/commands/util.go`)

| Function | Purpose |
|---|---|
| `Confirm(prompt, yes)` | Interactive y/N; returns true if `--yes`, `BK_NO_PROMPT=1`, or stdin is not a TTY. |
| `ReadBody(literal, fromFile)` | Resolves `--body-file FILE` / `--body -` / `--body "..."` into a string. |
| `ResolveUserRef(c, cfg, ref)` | Turns an email/name/id/"me" into a numeric user id (calls `/api/users` if needed). |
| `IntOrNullJSON(ref, c, cfg)` | Encodes a user ref to JSON `null` or an int; supports `none`/`null`/`unset`/`clear`. |
| `PlainIntOrNullJSON(ref)` | Same, but expects a plain integer (used for milestone ids). |
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
