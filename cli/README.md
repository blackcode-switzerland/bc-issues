# bk — blackcode-issues CLI

Personal-access-token-based CLI for the blackcode-issues API. Designed for
both humans at a terminal and LLM agents driving the platform end-to-end.

> **Recommended for agents.** If you're an AI agent, prefer `bk` over calling
> the HTTP API directly. The CLI wraps the same endpoints but handles auth,
> JSON-body encoding, pagination, file upload+embed, and stable exit codes for
> you — which makes automated runs markedly more reliable. The raw HTTP API
> stays fully supported; use it only when the CLI can't cover a case. This is a
> recommendation, not a requirement.

This is the quick-reference. For the full command reference, conventions, and
internals, see [`../docs/cli.md`](../docs/cli.md).

## Build

```sh
cd cli
go build -o bk ./cmd/bk        # or: make build
```

The binary lands at `cli/bk`. Drop it on your `$PATH` if you like. `make install`
installs it to `$GOBIN` (default `~/go/bin`); `make all` / `make dist`
cross-compile into `dist/`.

## First-time login

```sh
./bk login --server http://localhost:3000
```

`bk login` opens your browser to `/cli/authorize`, captures the minted token via
a loopback HTTP server, validates it against `/api/me`, and saves
credentials to `~/.config/bk/config.json` (mode 0600). Revoke any time from
**Settings → API Tokens**.

For headless / CI / agent use, paste a token from stdin instead:

```sh
echo "$MY_TOKEN" | ./bk login --server "$SERVER_URL" --token
```

There are no `BK_SERVER` / `BK_TOKEN` env vars — the server and token live in the
config file, chosen at login time.

## Active workspace

Projects, issues, tasks, labels, members, and invitations are scoped to a
workspace. Pick one once:

```sh
./bk workspace list            # active row marked with *
./bk workspace use acme        # by slug or numeric id
```

Workspace-scoped groups (`label`, `member`, `invite`) require an active
workspace; workspace paths accept the slug or the numeric id.

## Output formats

Every read command supports a global output flag, so you can pipe into `jq`,
`yq`, scripts, or feed structured output back into another LLM call.

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

Destructive commands that prompt (`project delete`, `project remove-member`,
`issue delete`, `issue detach`, `undo`) ask before acting. Skip the prompt with:

- `--yes` / `-y` on the command,
- the env var `BK_NO_PROMPT=1` (set this for agents/CI), or
- non-TTY stdin (the prompt is auto-skipped when not running in a terminal).

## Text input from stdin or a file

Long bodies (descriptions, comments) accept three forms so agents can pipe
markdown without quoting it (the `*-file` form wins if both are given):

- `--description "literal string"` / `--body "literal"`
- `--description -` / `--body -` (read from stdin)
- `--description-file FILE` / `--body-file FILE`

```sh
printf '## Plan\n- item\n' | ./bk issue create --project 6 --title "..." --description -
./bk issue comment 42 --body-file ./review.md
```

## Attaching files

`--file` uploads a local file and embeds it **inline** in the description/comment
body — images preview, video/audio get players, everything else gets a download
card (the same result as web drag-and-drop). It's repeatable and works on
`issue/task/project create` and `issue comment`:

```sh
./bk issue   create --project 6 --title "Crash" --file ./screenshot.png --file ./trace.log
./bk issue   comment 42 --body "see clip" --file ./demo.mp4
./bk project create --name "Q3 brief" --file ./brief.pdf
```

`--file` *appends* to the body. For a **structured** doc (files under specific
headings), reference local file paths directly in `--description` /
`--description-file` (or `--body`) and the CLI uploads + rewrites them in place:

```sh
cat > doc.md <<'MD'
## Screenshot
![](./shot.png)
## Recording
[](<~/clips/screen recording (1).mov>)
MD
./bk issue create --project 6 --title "Bug" --description-file doc.md
```

A path is only uploaded when it has no `http(s)://` scheme and exists on disk;
empty link text is auto-filled from the filename. **Paths with spaces or
parentheses must be angle-bracketed** — `[](</abs/my file (2).mp4>)` — because
plain Markdown stops the link destination at the first `)`.

Need just a url (e.g. for scripting)? `bk upload`:

```sh
URL=$(./bk upload ./diagram.png --json | jq -r '.[0].url')
```

`bk upload` and the local-path method create **no** sidebar attachment record.
`bk issue attach` is the opposite: it adds a file to the issue's **attachments
list** (sidebar), not the body.

## Commands

### Auth / session
```
bk login [--server URL] [--token]   authorize via browser (or paste token)
bk logout                           remove credentials
bk whoami                           print authenticated user
bk version                          print CLI version / commit / build date
```

### Workspaces
```
bk workspace list
bk workspace show [slug|id]            defaults to active
bk workspace create --name N [--use]   --use sets active (default true)
bk workspace use <slug|id>             set active workspace
```

### Projects
```
bk project list
bk project view <id>
bk project members <id>
bk project issues <id> [--status S] [--assignee <id|email|name|me>]
bk project tasks <id>

bk project create --name N [--description D | --description-file F]
bk project edit <id> [--name N] [--description D | --description-file F] [--status S]
bk project delete <id> [--yes] [--cascade | --detach]   move to Trash

bk project add-member <id> --email E [--role owner|admin|member|viewer]
bk project remove-member <id> --user <id|email|name> [--yes]
```

### Issues
```
bk issue list [--project N] [--status S]
              [--assignee <id|email|name|me>] [--mine] [--search TEXT]
bk issue view <id>

bk issue create --project N --title "..."
                [--description D | --description-file F]
                [--priority 1-5] [--status S]
                [--assignee <id|email|name|me>] [--task N]
                [--start-date YYYY-MM-DD] [--due-date YYYY-MM-DD]
                [--attach FILE]      add to the attachments list (sidebar)
                [--file FILE ...]    upload + embed inline in the description

bk issue edit <id> [--title T] [--description D | --description-file F]
                   [--status S] [--priority N]
                   [--assignee <id|email|name|me|none>]
                   [--task <N|none>]
                   [--start-date <YYYY-MM-DD|none>]
                   [--due-date <YYYY-MM-DD|none>]

bk issue assign <id> <user>        set assignee (id, email, name, or me)
bk issue unassign <id>             clear assignee
bk issue delete <id> [--yes]       move to Trash (restore with `bk trash`)

bk issue comment <id> --body "..." | --body-file F | --body -
                      [--reply-to COMMENT_ID]   threaded reply
                      [--file FILE ...]         upload + embed inline
bk issue comments <id>
bk issue activity <id>             comments + change history

bk issue attach <id> --file F      add to attachments list (sidebar; not the body)
bk issue attachments <id>
bk issue detach <issue-id> <attachment-id> [--yes]
```

Canonical issue statuses: `backlog`, `todo`, `in_progress`, `done`, `cancelled`.
`--assignee` accepts a numeric id, an email, a display name, or `me`. Pass `none`
(or `null`/`unset`/`clear`) on `issue edit` to clear `--assignee`, `--task`,
`--start-date`, or `--due-date`; omit the flag to leave it unchanged.

### Tasks
```
bk task list [--project N]
bk task view <id> [--include-issues]
bk task create --project N --name M
                    [--description D | --description-file F] [--due-date YYYY-MM-DD]
bk task edit <id> [--name M] [--description D | --description-file F]
                       [--due-date <YYYY-MM-DD|none>]
bk task delete <id> [--yes] [--cascade | --detach]   move to Trash
```

### Trash (recycle bin, workspace-scoped)

Deleting an issue, project, or task moves it to the Trash instead of
removing it permanently. Restore items individually, in bulk, or as a delete
group. Purging (permanent delete) is **owner-only**.

```
bk trash list [--type issue|project|task]
bk trash restore <type:id>...        e.g. bk trash restore issue:42 project:3
bk trash restore --batch <id>        restore a whole delete group
      [--restore-parents | --standalone]   force how dangling parents resolve
bk trash purge <type:id>... [--yes]  permanent delete (owner only)
bk trash purge --batch <id> [--yes]
bk trash empty [--yes]               permanently delete everything (owner only)
```

When a project/task is deleted with `--cascade`, its attached issues (and
a project's tasks) go to the Trash with it as one batch, so restoring the
batch brings the whole group back, re-linked. With `--detach` (the default) only
the parent is binned and the children stay active, unlinked. On restore, if an
item's parent is itself still in the Trash, the items it was deleted *with*
restore as a group; items deleted alone restore standalone — override per item in
the UI, or force it CLI-wide with `--restore-parents` / `--standalone`.

### Labels (workspace-scoped)
```
bk label list
bk label create --name N [--color #rrggbb] [--description D]
bk label delete <id>
bk label attach <issue-id> <label-id>
bk label detach <issue-id> <label-id>
```

### Members (workspace-scoped)
```
bk member list
bk member remove <user-id>         (owner only)
bk member leave                    (owner cannot leave)
```

### Invitations (workspace-scoped)
```
bk invite send <email>             prints a share link if the invitee has no account
bk invite list [--all]             owner only; --all includes accepted/revoked/expired
bk invite revoke <id>
bk invite accept <token>
bk invite decline <token>
bk invite pending                  invitations pending for your email
```

### Inbox
```
bk inbox list [--unread]           prints an unread count to stderr
bk inbox read [id ...] | --all     mark messages read
bk inbox archive <id> [id ...]     archive messages
```

### Users
```
bk user list                       list every user on the server
bk user view <id|email>            show one user (filtered client-side)
```

### Files
```
bk upload <file> [<file> ...]   upload file(s), print url(s) (no sidebar record)
```

### Activity / Analytics / Undo
```
bk activity [--limit N] [--cursor N]   global change feed (keyset-paginated)
bk analytics [flags]                    workspace analytics (summary + filters)
bk undo [--count N] [--yes]             roll back your last N writes (1-10)
```

`bk analytics` mirrors the web dashboard. Flags (all optional): `--view`
workspace|project|task|member, `--id`, `--ws <slug|id>`, `--from`/`--to`,
`--interval day|week`, and the `--status`/`--priority`/`--label`/`--assignee`
filters (repeatable or comma-separated). Default output is a readable summary;
`--json`/`--yaml` emit the full payload.

```
```

### Super admin (platform-wide; super admins only)
```
bk super-admin users                          list every member on the platform
bk super-admin whitelist list                 list allowed domains + emails
bk super-admin whitelist add --type domain|email --value V   allow a domain/email
bk super-admin whitelist remove <id> [--yes]  remove a whitelist entry
bk super-admin errors list [--status open|resolved] [--level L] [--from] [--to] [--limit] [--cursor] [--stats]
bk super-admin errors view <id>               full detail incl. stack + context
bk super-admin errors resolve <id>            mark resolved
bk super-admin errors unresolve <id>          re-open
bk super-admin errors delete <id> [id ...] [--yes]   permanently delete
bk super-admin errors stats                   total / open / resolved counts
```

These require a **super-admin token** — an account whose email is in the
server's `SUPER_ADMINS` env var. Any other token gets a `403` (exit code 4).
`admin` is an alias for `super-admin`. Whitelist and error changes apply across
the whole platform, not a single workspace. `bk whoami` shows `super: yes` when
your token has access.

## Permissions cheat-sheet

The CLI inherits whatever the underlying token can do. Roughly:

| Action | Required role |
|--------|---------------|
| Read projects/issues you belong to | any project member |
| Create/edit issues, comment, attach | project member (non-viewer) |
| Delete issue, delete attachment, edit project | project admin/owner |
| Delete project | project owner |
| Manage project members | project admin/owner |
| Remove workspace member, list invitations | workspace owner |
| `bk analytics` | any workspace member |
| `bk super-admin …` (users, whitelist, errors) | super admin (email in `SUPER_ADMINS`) |

A 403 on any command means the API rejected it for permissions; check your role
with `bk project members <id>`, `bk member list`, and `bk whoami`.

## Pagination

The main list commands (`bk issue list`, `bk project list`, `bk task list`)
return every matching item in one response — no pagination. `bk issue list`
includes a server-side `total` in `--json` / `--yaml` output.

Only the keyset-paginated feeds accept `--limit` / `--cursor`: `bk activity`,
`bk trash list`, and `bk super-admin errors list`. Their envelope is
`{ "data": [...], "next_cursor": <id|null> }`, and in table output the next
cursor is printed to stderr as `next page: --cursor=X` when more rows remain.

## Environment

- `BK_CONFIG_DIR` — override the config directory (default `~/.config/bk`).
- `BK_NO_PROMPT=1` — skip every interactive confirmation prompt
  (recommended for agents).

## Attachments

`bk issue create --attach FILE` and `bk issue attach <id> --file FILE` upload via
`POST /api/upload` (Vercel Blob), then attach the result. The server must have
`BLOB_READ_WRITE_TOKEN` configured. Allowed types: JPEG, PNG, GIF, WebP, PDF,
plain text, JSON, Markdown.
