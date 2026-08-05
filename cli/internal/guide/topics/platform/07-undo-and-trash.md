# Undo & Trash — recovering from a mistake

Two independent safety nets. Reach for `undo` first; it is the fastest way back.

## Undo — roll back your recent writes

```bash
bk undo --count 1 --yes      # undo the last write
bk undo --count 5 --yes
```

Covers **your** recent write operations, newest first. The count is **clamped**
to `limits.undo_max_count` in `bk meta` (it does not error if you ask for more —
it just undoes the maximum). Run `bk undo` with no `--count` to undo one.

## Trash — soft deletes

`bk issues project delete`, `bk issues task delete` and `bk issues issue delete` move the item to the
workspace Trash rather than destroying it.

```bash
bk trash list --json                 # paginated: --limit / --cursor
bk trash restore issue:42            # <type>:<id>, repeatable
bk trash purge issue:42              # permanently destroy specific items
bk trash empty                       # permanently destroy everything in Trash
```

**Take the ref from `bk trash list`, exactly as printed in its REF column.** It
is NOT the `#number` you use everywhere else, and the two do not interchange —
`bk trash list` is the only thing that produces a valid one.

Passing a ref that is not in this workspace's Trash now fails with exit 5 and
names the ref. It used to report `restored 1 item(s)` and exit 0 while restoring
nothing, so if you are branching on the count, make sure you are running a build
that refuses instead. A rejected restore is atomic: pass one bad ref alongside
good ones and nothing is restored.

The count reports what was actually brought back. Restoring something that was
never binned is a no-op and counts zero — not an error.

`purge` and `empty` are terminal: they also free the files that content
referenced (see `bk guide platform/storage`). Nothing brings them back — not even `undo`.

## Cascade vs detach

Deleting a project or task decides what happens to its children:

```bash
bk issues project delete 42 --cascade     # bin the attached tasks and issues too
bk issues project delete 42 --detach      # keep them, unlinked (the default)
```

Related commands: `bk undo`, `bk trash list|restore|purge|empty`, `bk issues project delete`, `bk issues task delete`, `bk issues issue delete`
