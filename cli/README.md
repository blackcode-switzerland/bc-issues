# bk — blackcode-issues CLI

Personal-access-token-based CLI for the blackcode-issues API. Designed for
both humans at a terminal and LLM agents driving the platform end-to-end.

## Build

```sh
cd cli
go build -o bk ./cmd/bk
```

The binary lands at `cli/bk`. Drop it on your `$PATH` if you like.

## First-time setup

```sh
./bk login --server http://localhost:3000
```

`bk login` opens your browser to `/cli/authorize`, captures the minted
token via a loopback HTTP server, and saves credentials to
`~/.config/bk/config.json` (mode 0600). Revoke any time from
**Settings → API Tokens**.

For headless / CI / agent use, paste a token instead:

```sh
echo "$MY_TOKEN" | ./bk login --server $SERVER_URL --token
```

## Output formats

Every read command supports a global output flag, so you can pipe into
`jq`, `yq`, scripts, or feed structured output back into another LLM call.

```
-o, --output table|json|yaml|yml   (default: table)
    --json                         shortcut for -o json
    --yaml / --yml                 shortcut for -o yaml
```

```sh
./bk project list --json | jq '.[].name'
./bk issue list --project 6 --yaml > issues.yaml
```

## Exit codes

Stable across releases so scripts/agents can branch on outcome:

| Code | Meaning |
|------|---------|
| 0 | success |
| 1 | generic error |
| 2 | bad usage (missing flag, invalid id, …) |
| 3 | not authenticated (401, or no config) |
| 4 | permission denied (403) |
| 5 | not found (404) |
| 6 | validation error (400/422) |
| 7 | user aborted at a confirm prompt |

## Confirmations and non-interactive use

Destructive commands (`delete`, `remove-member`, `detach`, `undo`) prompt
before acting. Skip the prompt with:

- `--yes` / `-y` on the command,
- the env var `BK_NO_PROMPT=1` (set this for agents/CI), or
- non-TTY stdin (the prompt is auto-skipped when not running in a terminal).

## Reading text input from stdin or a file

Long bodies (descriptions, comments) accept three forms so agents can
pipe markdown without quoting it:

- `--description "literal string"` / `--body "literal"`
- `--description -` / `--body -` (read from stdin)
- `--description-file FILE` / `--body-file FILE`

```sh
echo "## Plan\n- item" | ./bk issue create --project 6 --title "..." --description -
./bk issue comment 42 --body-file ./review.md
```

## Commands

### Auth
```
bk login [--server URL]            authorize via browser (or --token)
bk logout                          remove credentials
bk whoami                          print authenticated user
bk version                         print CLI version
```

### Projects
```
bk project list [--limit N] [--cursor N]
bk project view <id>
bk project members <id>            list members
bk project issues <id> [--status S] [--assignee <id|email|name|me>]
                       [--limit N] [--cursor N]
bk project milestones <id>

bk project create --name N [--description D | --description-file F]
bk project edit <id> [--name N] [--description D] [--status S]
bk project delete <id> [--yes]                       (owner only)

bk project add-member <id> --email E [--role owner|admin|member|viewer]
bk project remove-member <id> --user <id|email|name> [--yes]
```

### Issues
```
bk issue list [--project N] [--status S]
              [--assignee <id|email|name|me>] [--mine]
              [--limit N] [--cursor N]
bk issue view <id>

bk issue create --project N --title "..."
                [--description D | --description-file F]
                [--priority 1-5] [--status STATUS]
                [--assignee <id|email|name|me>]
                [--milestone N]
                [--start-date YYYY-MM-DD] [--due-date YYYY-MM-DD]
                [--attach FILE]

bk issue edit <id> [--title T] [--description D | --description-file F]
                   [--status S] [--priority N]
                   [--assignee <id|email|name|me|none>]
                   [--milestone <N|none>]
                   [--start-date <YYYY-MM-DD|none>]
                   [--due-date <YYYY-MM-DD|none>]

bk issue assign <id> <user>        shortcut for edit --assignee
bk issue unassign <id>             shortcut for edit --assignee none
bk issue delete <id> [--yes]       (project owner/admin)

bk issue comment <id> --body "..." | --body-file F | --body -
bk issue comments <id>             list comments
bk issue activity <id>             comments + change history

bk issue attach <id> --file F      upload + attach a file
bk issue attachments <id>          list attachments
bk issue detach <id> <attachment-id> [--yes]
```

`--assignee` accepts a numeric user id, an email, a display name, or
`me` (the current user). Pass `none` (or `null`/`unset`/`clear`) to
clear it. `--milestone`, `--start-date`, `--due-date` accept the same
`none` sentinel on `issue edit` and `milestone edit`.

> Note: `POST /api/issues` currently ignores `start_date`/`due_date` —
> create the issue first, then `bk issue edit --due-date YYYY-MM-DD`.

### Users
```
bk user list                       list every user on the server
bk user view <id|email>            show one user
```

### Milestones
```
bk milestone list [--project N]
bk milestone view <id> [--include-issues]

bk milestone create --project N --name N
                    [--description D | --description-file F]
                    [--due-date YYYY-MM-DD]
bk milestone edit <id> [--name N] [--description D]
                       [--due-date <YYYY-MM-DD|none>]
bk milestone delete <id> [--yes]
```

### Activity / Analytics / Undo
```
bk activity [--limit N] [--offset N]   global change feed
bk analytics                            admin-only stats
bk undo [--count N] [--yes]             roll back your last N writes (max 10)
```

## Permissions cheat-sheet

The CLI inherits whatever the underlying token can do. Roughly:

| Action | Required role |
|--------|---------------|
| Read projects/issues you belong to | any project member |
| Create/edit issues, comment, attach | project member (non-viewer) |
| Delete issue, delete attachment (if not uploader), edit project | project admin/owner |
| Delete project, remove other owners | project owner |
| Manage members | project admin/owner |
| `bk analytics` | server admin |

A 403 on any command means the API rejected it for permissions; check
your role with `bk project members <id>` and `bk whoami`.

## Pagination

`bk issue list --limit N` and `bk project list --limit N` switch to
envelope mode. In `--json` / `--yaml` output the envelope is
`{ "data": [...], "next_cursor": <id|null> }`. In table output the next
cursor is printed to stderr as `next page: --cursor=X`. Without
`--limit`/`--cursor`, the legacy flat array shape is preserved.

## Environment

- `BK_CONFIG_DIR` — override the config directory (default `~/.config/bk`).
- `BK_NO_PROMPT=1` — skip every interactive confirmation prompt
  (recommended for agents).

## Attachments

`bk issue create --attach FILE` and `bk issue attach <id> --file FILE`
upload via `POST /api/upload` (Vercel Blob). The server must have
`BLOB_READ_WRITE_TOKEN` configured. Allowed types: JPEG, PNG, GIF, WebP,
PDF, plain text, JSON, Markdown.
