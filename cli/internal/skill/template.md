---
name: blackcode-issues
description: Read and write issues, tasks and projects in blackcode issues via the `bk` CLI.
---

# blackcode issues

All access goes through the `bk` CLI. There is no supported HTTP API.

## First, always

1. `bk guide`  — the complete, current usage guide for the installed binary.
2. `bk meta`   — who you are, every workspace you can write to, the current
                 status/priority/health vocabularies, and every size limit.
                 Pick the workspace by NAME or SLUG, never by numeric id.

## Rules

- Add `--json` to every read command.
- Set `BK_NO_PROMPT=1` for unattended runs.
- Discover flags with `bk <group> <command> --help` before calling.
- Address projects/tasks/issues by their workspace #number.

## Keeping current

If any `bk` command prints an "update available" notice, or a command that used
to work now fails, run `bk skill sync` immediately, then retry.
