# Projects, tasks & issues

## Addressing

A project, task or issue is addressed by its **workspace #number** — the `#N`
shown in the app, unique per workspace. There is no separate global id, and the
internal database id is never exposed. A leading `#` is accepted.

```bash
bk issue view 42
bk issue view '#42'      # same thing
```

Never cache a `#number` from one workspace and use it in another.

## The core verbs

```bash
bk project list|view|create|edit|delete
bk task    list|view|create|edit|delete
bk issue   list|view|create|edit|delete
```

Each also has satellites — comments, members, updates, labels, attachments,
watch, activity. Run `bk <group> --help` for the current set; the help is
generated from the binary and is always right.

```bash
bk issue create --project 4 --title "Fix login" --priority 2
bk issue list --project 4 --status todo --mine --json
bk issue edit 42 --status in_progress --assignee me
```

## Vocabularies — always fetch, never assume

Status, priority and project-health values come from `bk meta`:

```bash
bk meta --json | jq '.vocabulary'
```

Issue priority is an integer; project priority is a `P0`–`P4` string (the CLI
also accepts the friendly words `urgent|high|medium|low|none`). Do not hardcode
either — `bk meta` is authoritative.

## Long bodies: three forms

Any `--description` / `--body` flag accepts:

```bash
--description "literal text"       # a string literal
--description -                    # read from stdin
--description-file path/to.md      # read from a file (takes precedence)
```

Prefer `--description-file` or stdin for multi-line content — it is the only way
to be sure you send **real newlines**. See `bk guide rich-text`.

## Clearing a nullable field

On `edit`, pass the literal `none` (also `null`, `unset`, `clear`;
case-insensitive) to null a field. **Omit** the flag to leave it unchanged.

```bash
bk issue edit 42 --task none --due-date 2026-06-30
```

Applies to `--assignee`, `--task`, `--start-date`, `--due-date`.

## User references

Anywhere a user is expected (`--assignee`, `bk issue assign`,
`bk project remove-member --user`) the CLI accepts:

- a numeric id — `42`
- an email — anything containing `@`
- a display name — `"Alice Andrews"`
- the literal `me`

Exception: `bk member remove` takes a numeric **user id** only.

## Dates & lengths

Dates are ISO-8601 (`YYYY-MM-DD`, or a full timestamp where a time matters).
Title/name length caps live in `bk meta` under `limits` — e.g.
`issue_title_max`, `project_name_max`, `task_name_max`, `label_name_max`.
Exceeding one returns a validation error (exit **6**) naming the cap.

Related commands: `bk project`, `bk task`, `bk issue`, `bk label`, `bk meta`
