# Overview — read this first

`bk` is how you operate the **Blackcode platform**: workspaces, members, labels,
files, tokens and inbox — plus one or more **apps** built on top of them.

There is **one supported interface: this CLI.** The HTTP API behind it is private
plumbing with no public contract — do not call it directly, and do not build
against an OpenAPI spec (there isn't one any more).

## Platform verbs and app verbs

A workspace is the company; an app is a capability inside it. That split runs
through everything here:

- **Platform verbs are bare** — `bk workspace list`, `bk label create`,
  `bk upload`, `bk trash list`. They mean the same thing whichever app you are
  working in.
- **App verbs sit behind the app's name** — `bk issues issue create`. Run
  `bk --help` for the list of apps this binary knows, and `bk <app> --help` for
  one app's nouns.

`bk meta` tells you which apps you can actually reach; you will not be shown one
you have no access to. Before 1.10.0 app verbs were bare — the app name was
simply absent. Those spellings still run and print `deprecated:` on stderr,
naming the replacement, and go away two minor releases from now.

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
