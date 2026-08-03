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

`bk project delete`, `bk task delete` and `bk issue delete` move the item to the
workspace Trash rather than destroying it.

```bash
bk trash list --json                 # paginated: --limit / --cursor
bk trash restore issue:42            # <type>:<id>, repeatable
bk trash purge issue:42              # permanently destroy specific items
bk trash empty                       # permanently destroy everything in Trash
```

`purge` and `empty` are terminal: they also free the files that content
referenced (see `bk guide storage`). Nothing brings them back — not even `undo`.

## Cascade vs detach

Deleting a project or task decides what happens to its children:

```bash
bk project delete 42 --cascade     # bin the attached tasks and issues too
bk project delete 42 --detach      # keep them, unlinked (the default)
```

Related commands: `bk undo`, `bk trash list|restore|purge|empty`, `bk project delete`, `bk task delete`, `bk issue delete`
