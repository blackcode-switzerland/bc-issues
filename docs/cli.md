# CLI (`bk`)

The `bk` command-line tool is a Go binary that talks to the blackcode-issues HTTP API. It's the recommended interface for scripts, agents, and anyone who'd rather type than click.

It lives in [`/cli`](../cli) as a standalone Go module — separate from the web app, but using the same API.

---

## Table of contents

1. [Overview](#overview)
2. [Build & install](#build--install)
3. [Project layout](#project-layout)
4. [Authentication](#authentication)
5. [Command reference](#command-reference)
6. [Configuration & environment](#configuration--environment)
7. [Output formats](#output-formats)
8. [Exit codes](#exit-codes)
9. [Patterns for agents and scripts](#patterns-for-agents-and-scripts)
10. [Internals](#internals)

---

## Overview

| Property | Value |
|---|---|
| Language | Go 1.26 |
| Module | `github.com/mustneerar7/blackcode-issues/cli` |
| Binary | `bk` |
| Framework | [cobra](https://github.com/spf13/cobra) |
| Auth | Bearer API tokens (same `api_tokens` table the web uses) |
| Default server | `http://localhost:3000` |

The CLI mirrors the web app's capabilities: projects, members, issues, comments, attachments, milestones, activity feed, analytics, undo. Output defaults to a human-readable table; `--json` and `--yaml` produce machine-friendly formats with stable shapes.

A typical session:

```bash
bk login                           # browser-based OAuth-style flow
bk project list                    # show your projects
bk issue create --project 1 --title "Fix login" --priority 2
bk issue list --project 1 --mine
bk issue comment 42 --body "Investigating now"
bk undo --count 1                  # roll back the last operation
```

---

## Build & install

All commands are run from the `cli/` directory.

```bash
make build            # builds ./bk for the host platform
make install          # installs to $GOBIN (default: ~/go/bin)
make all              # cross-compiles to dist/{darwin,linux,windows}/{amd64,arm64}/bk[.exe]
make dist             # `all` plus SHA256SUMS
make test             # go test ./...
make run -- <args>    # development shortcut: `go run ./cmd/bk <args>`
```

Versions are stamped into the binary via `-ldflags`:

- `commands.Version` — `git describe` (or `"dev"`)
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
│   ├── client/               # HTTP client + DTO types
│   ├── commands/             # Cobra commands (root + subcommands)
│   ├── config/               # ~/.config/bk/config.json loader
│   └── output/               # table / json / yaml renderer
├── go.mod
├── Makefile
└── README.md
```

Direct dependencies are intentionally minimal: `cobra`, `golang.org/x/term` (for hidden password input), `gopkg.in/yaml.v3`.

---

## Authentication

### `bk login` — browser flow

1. The CLI generates a random 32-byte hex `state` token.
2. It binds a loopback TCP listener at `127.0.0.1:<random ephemeral port>`.
3. It opens this URL in the system browser:
   ```
   {server}/cli/authorize?callback=http://127.0.0.1:{port}/callback&state={hex}&name=cli-{hostname}
   ```
4. You sign in (if needed) and approve. The web app's `/cli/authorize` route (`app/api/cli/authorize/route.ts`) mints an API token and 302s the browser to the loopback `callback` with `?token=…&state=…` appended.
5. The CLI's listener accepts the request, validates `state` (constant-time compare), pulls the token from the query string, and shuts the listener down.
6. The CLI validates the token by calling `GET /api/users/me` with `Authorization: Bearer …`.
7. The token + user info land in `~/.config/bk/config.json` with mode `0600`.

The browser shows a short success page; the listener processes one request and exits.

### `bk login --token` — headless flow

For CI or environments without a browser. The CLI reads the token from stdin (hidden if a TTY, plain if piped). Useful when an admin mints a token from `/dashboard/settings` and pastes it into a one-off setup script:

```bash
echo "$BK_TOKEN" | bk login --token --server https://issues.example.com
```

### `bk logout`

Deletes `~/.config/bk/config.json`. The corresponding token row remains in the database — revoke it explicitly with the web UI or `DELETE /api/tokens/[id]` if you want it dead server-side.

### `bk whoami`

Hits `GET /api/users/me`. Prints the authenticated user's id, email, name, role, and how the auth was resolved (`session` vs `token`).

---

## Command reference

Every read command supports `-o table|json|yaml` (default `table`), plus `--json` / `--yaml` shortcuts. Every destructive command supports `--yes` / `-y` to skip the confirmation prompt (and respects `BK_NO_PROMPT=1`).

### Auth

| Command | Purpose |
|---|---|
| `bk login [--server URL] [--token]` | Browser or headless login. |
| `bk logout` | Clear local config. |
| `bk whoami` | Show current user. |
| `bk version` | Print version, commit, build date. |

### Projects

| Command | Backend call | Notes |
|---|---|---|
| `bk project list [--limit N] [--cursor ID]` | `GET /api/projects` | Cursor-paged when `--limit` set; otherwise flat list. |
| `bk project view <id>` | `GET /api/projects/:id` | |
| `bk project members <id>` | `GET /api/projects/:id/members` | |
| `bk project issues <id> [--status S] [--assignee REF]` | `GET /api/projects/:id` | Filters client-side. |
| `bk project milestones <id>` | `GET /api/milestones?project_id=:id` | |
| `bk project create --name N [--description D \| --description-file F]` | `POST /api/projects` | |
| `bk project edit <id> [--name] [--description] [--status]` | `PATCH /api/projects/:id` | |
| `bk project delete <id> [--yes]` | `DELETE /api/projects/:id` | Owner only. |
| `bk project add-member <id> --email E [--role owner\|admin\|member\|viewer]` | `POST /api/projects/:id/members` | |
| `bk project remove-member <id> --user REF [--yes]` | `DELETE /api/projects/:id/members` | `REF` = id, email, or display name. |

### Issues

| Command | Backend call | Notes |
|---|---|---|
| `bk issue list [--project N] [--status S] [--assignee REF \| --mine] [--limit] [--cursor]` | `GET /api/issues` | `--mine` = `--assignee me`. |
| `bk issue view <id>` | `GET /api/issues/:id` | |
| `bk issue create --project N --title T [...]` | `POST /api/issues` | Full flag list below. |
| `bk issue edit <id> [...]` | `PATCH /api/issues/:id` | Pass `none`/`null`/`unset`/`clear` to null a field. |
| `bk issue assign <id> <user>` | shortcut for `edit --assignee` | |
| `bk issue unassign <id>` | shortcut for `edit --assignee none` | |
| `bk issue delete <id> [--yes]` | `DELETE /api/issues/:id` | Admin/owner only. |
| `bk issue comment <id> --body "..." \| --body - \| --body-file F` | `POST /api/issues/:id/comments` | |
| `bk issue comments <id>` | `GET /api/issues/:id/comments` | |
| `bk issue activity <id>` | `GET /api/issues/:id/activity` | Merged comments + change log. |
| `bk issue attach <id> --file F` | `POST /api/upload` + `POST /api/issues/:id/attachments` | Two-step. |
| `bk issue attachments <id>` | `GET /api/issues/:id/attachments` | |
| `bk issue detach <id> <attachment-id> [--yes]` | `DELETE /api/issues/:id/attachments?attachmentId=N` | |

**`issue create` flags**:

```
--project N             (required)
--title "..."           (required)
--description D | -     literal or stdin
--description-file F    read description from file
--priority 1-5          default 3
--status S              backlog|todo|in_progress|blocked|in_review|done|cancelled
--assignee REF          email, id, name, or "me"
--milestone N
--start-date YYYY-MM-DD
--due-date YYYY-MM-DD
--attach FILE           uploads + attaches in one step
```

> The API currently ignores `start_date`/`due_date` on **create**; pass them to `edit` afterwards if needed.

### Users

| Command | Backend call | Notes |
|---|---|---|
| `bk user list` | `GET /api/users` | |
| `bk user view <id\|email>` | `GET /api/users` + filter | The API doesn't have a single-user endpoint; CLI filters client-side. |

### Milestones

| Command | Backend call |
|---|---|
| `bk milestone list [--project N]` | `GET /api/milestones[?project_id=N]` |
| `bk milestone view <id> [--include-issues]` | `GET /api/milestones/:id[?includeIssues=true]` |
| `bk milestone create --project N --name N [...]` | `POST /api/milestones` |
| `bk milestone edit <id> [...]` | `PATCH /api/milestones/:id` |
| `bk milestone delete <id> [--yes]` | `DELETE /api/milestones/:id` |

### Activity / undo / analytics

| Command | Backend call |
|---|---|
| `bk activity [--limit N] [--offset N]` | `GET /api/activity` |
| `bk analytics` | `GET /api/analytics` (admin-only, JSON output) |
| `bk undo [--count N] [--yes]` | `POST /api/undo` — rolls back your last N (max 10) ops. |

### Body input convention

For any `--description` / `--body` flag, three forms work:

```bash
--description "literal text"      # string literal
--description -                   # read from stdin
--description-file path/to.md     # read from file
```

### Nullable field convention

For `edit` commands on nullable fields (`--assignee`, `--milestone`, `--start-date`, `--due-date`):

- Omit the flag → leave it unchanged.
- Pass `none`, `null`, `unset`, or `clear` → explicitly null it.

```bash
bk issue edit 42 --milestone none --due-date 2026-06-30
```

### User references

Wherever a command takes a "user reference" (`--assignee`, `--user`, etc.), the CLI accepts:

- A numeric id (`42`)
- An email (`alice@example.com`)
- A display name (`"Alice Andrews"`)
- The literal string `me`

Non-numeric refs trigger a `GET /api/users` lookup the first time they're resolved.

---

## Configuration & environment

### Config file

`~/.config/bk/config.json` (mode `0600`):

```json
{
  "server": "http://localhost:3000",
  "token":  "bk_live_…",
  "user_id": 7,
  "email":  "alice@example.com"
}
```

Override the directory with `BK_CONFIG_DIR`.

### Environment variables

| Variable | Effect |
|---|---|
| `BK_CONFIG_DIR` | Override config directory. |
| `BK_NO_PROMPT=1` | Skip all interactive confirmations (recommended for CI / agents). |

### Server selection

`bk login --server https://issues.example.com` writes the URL into config and all subsequent commands use it. To switch servers later, log out and log in again pointing at the new URL.

---

## Output formats

### Table (default)

`text/tabwriter` aligned columns. Each command's headers vary; for example `bk project list`:

```
ID    NAME            STATUS    ROLE    ISSUES (OPEN/TOTAL)
1     Onboarding      active    owner   3/12
2     Trinity Spec    active    member  0/4
```

### JSON (`--json` or `-o json`)

Pretty-printed with 2-space indent. Pagination responses are wrapped:

```json
{
  "data":        [ … ],
  "next_cursor": 42
}
```

### YAML (`--yaml` / `--yml` / `-o yaml`)

Same shape, YAML-formatted.

### Pagination

In **table** mode, when a `next_cursor` is present, the CLI prints `next page: --cursor=42` to stderr — useful for scripting (`bk issue list --json | jq '.next_cursor'`).

---

## Exit codes

Stable for scripting:

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Generic / runtime error |
| 2 | Bad usage (missing flag, malformed argument) |
| 3 | Not authenticated (401, or no config) |
| 4 | Permission denied (403) |
| 5 | Not found (404) |
| 6 | Validation error (400 / 422) |
| 7 | User aborted (declined a confirm prompt) |

The mapping happens in `cmd/bk/main.go` by inspecting the `APIError.Status` field returned from the HTTP client.

---

## Patterns for agents and scripts

### Non-interactive defaults

```bash
export BK_NO_PROMPT=1
bk issue delete 42      # no confirmation; obeys --yes/-y implicitly
```

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
echo "$BK_TOKEN" | bk login --token --server "$BK_SERVER"
```

### Inline error inspection

```bash
bk issue view 999999 || echo "exit code: $?"
# exit code: 5   (not found)
```

### Robust scripting checklist

- Set `BK_NO_PROMPT=1`.
- Always use `--json` for parsing; the table format is for humans.
- Branch on exit codes, not stderr.
- For long-running scripts, regenerate the token periodically (the CLI doesn't refresh automatically).

---

## Internals

### HTTP client (`internal/client/`)

Built around a tiny `Client` struct:

- Constructor: `client.New(baseURL, token) *Client`
- Methods:
  - `get(path, out)`
  - `postJSON(path, body, out)`
  - `patchJSON(path, body, out)`
  - `deleteJSON(path, body, out)`
  - `UploadFile(path)` — multipart upload helper.
- Common headers on every request: `Authorization: Bearer …` (if token set), `Accept: application/json`, `User-Agent: bk-cli/<version>`.
- 30-second timeout.
- Non-2xx responses decode into an `APIError { Status, ErrorMsg, Suggestion, Details }`; the `main.go` translator maps this to an exit code.

DTO types in `internal/client/types.go` mirror the backend's JSON shapes (`User`, `Project`, `Issue`, `Milestone`, `Comment`, `Attachment`, `ProjectMember`, plus the page wrappers).

### Auth flow (`internal/commands/login.go`)

The state machine:

1. Generate `state` (`crypto/rand`, hex-encoded).
2. Bind `127.0.0.1:0` (kernel picks port).
3. Open browser to `{server}/cli/authorize?…`.
4. Loopback server handles **one** request to `/callback`:
   - Validates `state` with `subtle.ConstantTimeCompare`.
   - Reads `token` from the query string.
   - Responds with a tiny "you can close this window" HTML page.
   - Shuts down.
5. Validate the token (`GET /api/users/me`).
6. Save config (`internal/config.Save`).

The server-side counterpart is in [`app/api/cli/authorize/route.ts`](../app/api/cli/authorize/route.ts). It requires a logged-in session and enforces that `callback` is a `localhost` or `127.0.0.1` URL.

### Helpers (`internal/commands/util.go`)

| Function | Purpose |
|---|---|
| `Confirm(prompt, autoYes)` | Interactive y/N; auto-yes if `--yes`, `BK_NO_PROMPT=1`, or stdin is not a TTY. |
| `ReadBody(literal, fromFile)` | Resolves `--body "..."` / `--body -` / `--body-file …` into a string. |
| `ResolveUserRef(c, cfg, ref)` | Turns an email/name/id/"me" into a numeric user id (calls `/api/users` if needed). |
| `IntOrNullJSON(ref, c, cfg)` | Encodes the ref to JSON `null` or `int`; supports `none`/`null`/`unset`/`clear`. |
| `PlainIntOrNullJSON(ref)` | Same, but doesn't resolve user refs (used for milestone ids etc.). |

### Output (`internal/output/`)

- `RegisterFlags(cmd)` attaches `-o/--output`, `--json`, `--yaml/--yml` to a command.
- `Resolve(cmd)` reads them and returns `FormatTable | FormatJSON | FormatYAML`.
- `Render(format, data, tableFn)` dispatches:
  - **JSON** — `json.MarshalIndent` with two spaces.
  - **YAML** — `yaml.Encoder` with 2-space indent.
  - **Table** — calls the command-provided `tableFn(w)` where `w` is a pre-configured `tabwriter.Writer`.

### Pagination shape

The CLI keeps the same paginated wrapper as the API for `--json` / `--yaml`:

```json
{ "data": [ … ], "next_cursor": 42 }
```

For **table** output it prints just the data rows, then a stderr hint:

```
next page: --cursor=42
```

This lets shell scripts grep for the cursor without mixing data and metadata on stdout.

---

## See also

- [Backend doc](./backend.md) — the HTTP API the CLI calls.
- [Frontend doc](./frontend.md) — the web side of the same data.
- [`cli/README.md`](../cli/README.md) — the in-repo CLI README (build/usage quick-reference).
