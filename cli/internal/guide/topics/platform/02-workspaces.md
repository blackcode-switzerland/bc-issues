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

## Membership is not access

Two different things, and confusing them is the second most common mistake here:

- **Membership** — you are in the organisation. `bk member list` shows it.
- **App access** — you may open a given app inside that organisation.
  `bk app access list <app>` shows it.

`bk workspace list` shows only the workspaces you can use **this app** in. A
workspace where the app is switched off, or where you were never granted it, is
not somewhere you can write, so listing it would be offering a guaranteed
failure.

```bash
bk workspace list          # workspaces you can use this app in
bk workspace list --all    # every workspace you are a member of, + which apps
                           # you can reach in each
```

If a workspace you expected is missing, run `--all`. An empty APPS column means
you are a member but hold no access there.

A request into a workspace you have no access to fails with exit code 4 and a
`hint:` line naming who can grant it. That hint is the recovery path — read it
rather than retrying.

## Apps in a workspace

```bash
bk app list                                 # which apps this workspace runs
bk app access list <app>                    # who has access, and who does not
bk app access grant <app> --user <ref>      # owner only
bk app access revoke <app> --user <ref>     # owner only
bk app default-access <app> --mode …        # all_members | invite_only
bk app enable <app>                         # owner only
bk app disable <app> --confirm <app>        # owner only; revokes every grant
```

Run `bk meta` for the app slugs you can reach and `bk app list` for how each one
currently grants access — neither is baked into this binary.

`--mode all_members` means everyone in the workspace has the app and anyone
joining gets it automatically. `--mode invite_only` means access is granted one
person at a time; invite someone straight into it with
`bk invite send <email> --app <app>`, which grants it on accept even under
`invite_only`.

You cannot disable the app you are calling from — it would lock the whole
workspace out of the product with no way back in.

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

Irreversible. Not the Trash — `bk trash` cannot bring it back. It
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

Related commands: `bk meta`, `bk workspace list|show|create|use|edit|transfer|delete`, `bk app list|enable|disable|default-access`, `bk app access list|grant|revoke`, `bk member list|remove|leave`, `bk invite send|list|revoke|pending`
