# Workspaces — pick the right one FIRST

All tenant data lives inside a workspace, and most accounts belong to more than
one. **Writing to the wrong workspace is the single most common agent mistake.**

## The rule

```bash
bk meta --json      # lists every workspace you belong to + the active one
```

Match the user's intent to a workspace by its human-readable **`name`** or
**`slug`**. Do **not** pick by the numeric `id` — ids are opaque sequential
integers and trivial to confuse.

`active_workspace` in `bk meta` is only a **default**. It is not necessarily
where the user means to write. Confirm before you create anything.

## Setting the target

```bash
bk workspace use <slug>        # sets the active workspace, persisted
bk --ws <slug> issue list      # targets ONE command; does not change the active one
```

`--ws` is a persistent flag available on every command. Use it for reads against
another workspace so you never mutate the caller's active workspace as a side
effect.

## Managing workspaces

```bash
bk workspace list
bk workspace show [slug|id]
bk workspace create --name "Growth"
bk workspace edit [slug|id] --name "…"
bk workspace transfer [slug|id] --to <user>    # hand over ownership
bk member list
bk member remove <user_id>                     # owner only
bk member leave
```

Name length cap: see `limits.workspace_name_max` in `bk meta`.

## Deleting a workspace

Irreversible. Not the Trash — `bk trash` and `bk undo` cannot bring it back. It
takes the workspace's projects, tasks, issues, labels and comments with it.

```bash
bk workspace delete scratch-ws --confirm scratch-ws
```

Three things to know before you call it:

- `--confirm` must repeat the argument exactly. It is required even with `--yes`
  and even under `BK_NO_PROMPT=1` — the y/N prompt auto-approves in unattended
  mode, so repeating the slug is the only guard that actually protects you.
- The target is always an explicit argument. Unlike most commands this never
  falls back to your active workspace.
- Owner only. To hand a workspace over instead, use `bk workspace transfer`.

If you delete your active workspace, the active selection is cleared — run
`bk workspace use <slug>` before the next scoped command.

Related commands: `bk meta`, `bk workspace list|show|create|use|edit|transfer|delete`, `bk member list|remove|leave`, `bk invite send|list|revoke|pending`
