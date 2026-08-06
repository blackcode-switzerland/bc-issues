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

`storage` is **cross-app and bare**, like `bk search`: one cabinet, one
workspace quota, the same rows whichever app you ask. Uploading is the half that
belongs to an app — you upload INTO one app and list ACROSS all of them. Run
`bk guide platform/apps` for the tiers.

```bash
bk storage list --json         # every app's files + what references them + usage
bk storage list --app issues   # only the files one app uploaded
bk storage rm <id>             # permanently delete an orphan
```

`bk storage rm` is refused with a **409 `file_in_use`** conflict if anything
still references the file — **including a trashed item**. Empty or purge the
Trash first if you mean to reclaim the space.

## Storage is shared between apps

One store, one workspace quota, files kept under a per-app prefix. Each file
carries the app that uploaded it (the **APP** column, `--app` to filter), but the
usage total is always the whole workspace's — filtering the list never changes
it. That is exactly why this verb is bare while `bk <app> upload` is not: the
app decides where a NEW file is filed, not which files you can see.

The per-app views of files live with their app — `bk issues attachment list` is
the workspace's issue attachments, and `bk issues issue attachments <n>` is one
issue's.

Reference counting spans **every** app, and a delete needs a proven negative: a
file is removable only when no app references it. An app the deployment can read
directly is scanned live; every other app is answered for out of a shared index
that app's own database keeps up to date. If neither is available for some app,
the delete is **refused** rather than allowed. Read an unexpected refusal as
*"could not prove this file is unused"*, not as *"the file is in use"*; retrying
later is the right response, and no amount of `--yes` overrides it.

These commands require workspace **owner** role; anything else gets exit **4**.

Related commands: `bk storage list|rm`, `bk issues upload`, `bk issues attachment list`, `bk issues trash purge|empty`, `bk guide platform/apps`
