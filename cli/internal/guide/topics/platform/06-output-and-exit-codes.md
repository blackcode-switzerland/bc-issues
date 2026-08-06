# Output, exit codes & scripting

## Always ask for JSON

```bash
bk issues issue list --json
bk issues issue list -o json      # same
bk issues issue list --yaml       # or -o yaml / --yml
```

Table output is for humans and its layout is not a contract. Parse `--json`.

Global flags, available on every command:

| Flag | Effect |
|---|---|
| `--json` / `--yaml` / `--yml` / `-o FORMAT` | output format (default `table`) |
| `--ws <slug\|id>` | target one command at another workspace |
| `-v` / `--verbose` | log each HTTP request/response to stderr (or `BK_DEBUG=1`) |

## Shapes

A **list** command prints `{ "data": [ … ], "next_cursor": <id|null> }`.
`bk issues issue list` adds `"total"`. A **single-item** command prints the bare object.

Most lists return everything in one response and `next_cursor` is `null`. Only
three feeds paginate: `bk activity`, `bk issues trash list`, and
`bk super-admin errors list`. They take `--limit` / `--cursor`; follow
`next_cursor` until it is `null`. Page size defaults and caps are in `bk meta`
under `limits.page_size_default` / `limits.page_size_max`.

In table mode a paginated command prints `next page: --cursor=<id>` to **stderr**
when more rows remain, so `--json` stdout stays clean.

## Exit codes — branch on these, not on stderr text

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | generic / runtime error |
| 2 | bad usage (missing required flag, invalid id, wrong number of arguments, unknown flag or command) |
| 3 | not authenticated (401, or no config) |
| 4 | permission denied (403) |
| 5 | not found (404) |
| 6 | validation error (400 / 422) |
| 7 | user aborted (declined a confirmation prompt) |
| 8 | this `bk` is below the server's minimum supported version — upgrade required |
| 9 | update available (`bk skill check` / `bk skill sync` found something behind) |

A mistyped command or subcommand is always an error, never a silent success —
`bk workspace notacmd` exits 2, it does not print help and exit 0.

## stdout vs stderr

Data goes to **stdout**. Everything else — errors, `hint:` lines, update
notices, pagination breadcrumbs — goes to **stderr**. `--json` stdout is always
parseable, whatever else the command printed.

## When something fails

`bk` prints `error: …` and, when the failure is recoverable, a `hint:` line
naming the exact fix. Read the hint before retrying — for a renamed flag it tells
you the new spelling; for drift it tells you to run `bk skill sync`.

## Scripting checklist

- `export BK_NO_PROMPT=1`
- Pick the workspace first (`bk workspace use …` or `--ws`)
- `--json` for everything you parse
- Branch on exit codes
- Use `bk issues move` / `bk issues copy` to relocate items — never re-create by hand
- Discover flags with `bk <group> <cmd> --help` before calling

```bash
bk issues issue list --project 1 --status todo --json \
  | jq -r '.data[].id' \
  | xargs -n1 -I{} bk issues issue edit {} --status in_progress --assignee me
```

Related commands: every command; see `bk activity`, `bk issues trash list`, `bk super-admin errors list` for pagination
