# Moving & copying between workspaces

**Never hand-roll a cross-workspace migration** by reading items out and
re-creating them. That loses satellite data (comments, attachments, labels,
watchers) and, if you pipe titles/bodies through a non-UTF-8 shell, corrupts the
text (see `bk guide platform/encoding`). Use the built-in transfer.

```bash
# Move a whole project — its tasks and issues come along
bk issues move --to growth --project 42

# Copy specific issues, leaving the originals in place
bk issues copy --to growth --issue 108 --issue 106

# Move a project's structure but not its issues
bk issues move --to growth --project 42 --cascade-issues=false
```

`--project`, `--task` and `--issue` are repeatable and take **#numbers** in the
**source** workspace. `--to` takes the target workspace slug or id. The source is
the active workspace (or whatever `--ws` targets).

## Guarantees

- **Atomic.** One server-side transaction. On any error nothing is written to the
  target and the source is untouched. There is no partial state to clean up.
- **New `#number`s** are allocated in the target — the old ones do not carry over.
  Re-read the report (or the target) for the new ids.
- **Labels** are matched by name in the target, and created there if missing.
- **User references** that aren't in the target's membership are dropped and
  listed under `adjustments` in the response. Read that list — a silently
  unassigned issue is the usual surprise.

```bash
bk issues move --to growth --project 42 --json | jq '.adjustments'
```

Related commands: `bk issues move`, `bk issues copy`, `bk meta`
