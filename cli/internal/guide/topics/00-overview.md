# Overview — read this first

`bk` is how you operate **blackcode issues**: an issue tracker with projects,
tasks, issues, comments, labels, members, files and analytics.

There is **one supported interface: this CLI.** The HTTP API behind it is private
plumbing with no public contract — do not call it directly, and do not build
against an OpenAPI spec (there isn't one any more).

## The first four commands, in this order

```bash
bk guide            # this document — the complete usage guide for YOUR binary
bk meta             # who you are, every workspace you can write to, live limits
bk workspace use <slug>
bk <group> --help   # discover flags before you call anything
```

## What lives where

Two kinds of knowledge, two homes. Knowing the split saves you a wrong guess:

| Kind | Where | Example |
|---|---|---|
| **How the tool behaves** | this guide, embedded in the binary | flag conventions, exit codes, the upload→embed flow |
| **What the data is right now** | `bk meta`, fetched live | status/priority values, workspace list, size caps |

This guide **never** restates a value from `bk meta` — if you need a number or a
vocabulary, fetch it. That is why the two can never disagree.

## Ground rules

- Add `--json` to every read command. Table output is for humans.
- Set `BK_NO_PROMPT=1` for unattended runs.
- Address projects, tasks and issues by their workspace **#number**.
- Pick the workspace by **name or slug**, never by numeric id.

Related commands: `bk guide`, `bk guide --list`, `bk meta`, `bk --help`
