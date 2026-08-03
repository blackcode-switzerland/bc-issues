# Storage — what deleting actually frees

Uploaded files are tracked per workspace with a reference count.

## The rule that surprises people

**Editing a file out of a body does NOT delete the bytes.** That is deliberate —
undo and restore have to stay safe, so the file survives until nothing can bring
the content back.

**Terminal deletes DO free storage**, automatically:

- hard-deleting a comment or reply, and
- purging an item from Trash

release the files that content referenced, once nothing else references them.

So an edit leaves an orphan. Clearing orphans is an explicit owner action.

## Owner review & cleanup

```bash
bk storage list --json         # every file + what references it + total usage
bk storage rm <id>             # permanently delete an orphan
bk storage attachments         # the workspace-wide attachments view
```

`bk storage rm` is refused with a **409 `file_in_use`** conflict if anything
still references the file — **including a trashed item**. Empty or purge the
Trash first if you mean to reclaim the space.

These commands require workspace **owner** role; anything else gets exit **4**.

Related commands: `bk storage list|rm|attachments`, `bk trash purge|empty`
