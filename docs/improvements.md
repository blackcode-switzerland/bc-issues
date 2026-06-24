# Improvements / backlog

Forward-looking notes on known gaps and things worth doing later. Unlike
[`next-fixes.md`](./next-fixes.md) (a *resolved* historical friction log), this
file is the place to **add** items as we discover them and refer back when we
pick them up. Newest first. When an item ships, move a one-line note to
[`api-changelog.md`](./api-changelog.md) and delete it here.

---

## Storage cleanup — follow-ups  ·  noted 2026-06-23

The owner-facing Storage page + ledger + reference engine + `bk storage` shipped
2026-06-23, and **automatic cleanup runs on terminal deletes**: hard-deleting a
comment/reply or purging an item from Trash (single, batch, or empty) now sweeps
the files that content referenced and removes any that nothing else points at
(`sweepOrphanedUrls`, `lib/blob-gc.ts`), gated by the same live system-wide
reference scan. Removing a file from a body via editing still never deletes bytes
(undo/restore safe) — those become "Unused" orphans the owner clears from the
Storage page. Remaining work:

1. **Storage quota enforcement (priority: low).** The base exists —
   `workspaces.storage_limit_bytes` (nullable, unenforced) and
   `computeWorkspaceStorageUsage()`. To enforce, compare usage + incoming size at
   upload time (in `/api/upload` and the `/api/upload/blob` token handshake) and
   reject over-limit uploads with a clear error. Add an owner UI to set the limit.

---

## Other gaps noted while building file-embedding (2026-06-23)

Lower priority; capture so they aren't lost.

- **Native `<iframe>` embeds are dropped on render (by design).** Raw HTML5
  `<video>` / `<audio>` tags that point at an **uploaded** asset now render as the
  inline player (shipped 2026-06-24 — `upgradeUploadedMedia`, `lib/rich-text.ts`).
  Still stripped: `<iframe>` and external (non-uploaded) media — keep it that way
  unless we add a vetted allowlist of embed providers (YouTube/Loom/etc.) with
  sandboxing. Embedding external media means uploading it first.

- **No standalone server upload convenience for raw API.** Direct-API agents do
  two calls (upload, then reference the url). Fine as a REST pattern, but a
  combined "create with file" endpoint could be added if demand appears.
