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

## Full table support in rich text  ·  noted 2026-06-23  ·  priority: medium

**Goal.** Tables should round-trip and render everywhere (web editor, read-only
display, Markdown, HTML, CLI/API), the same way images and file attachments do.

**Current state (partial / broken).**
- The **server sanitizer allows table tags** — `lib/rich-text.ts` `SANITIZE_OPTS.allowedTags`
  already lists `table/thead/tbody/tr/th/td`, and `marked` (gfm) converts
  Markdown tables to that HTML. So a table *survives storage*.
- But the **read-only display has no table node**: the `useEditor` extension list
  in `components/rich-text-editor.tsx` (both the editing editor and the
  `RichTextDisplay` instance) is `StarterKit + Underline + TaskList/TaskItem +
  Image + Link + Mention + fileAttachment`. TipTap drops unknown nodes on parse,
  so a stored `<table>` **renders as plain text / collapses** on the page.
- Net: an agent (or Markdown author) can submit a table, it's stored, but it
  doesn't display. Inconsistent and surprising.

**What's needed.**
1. Add TipTap table extensions to **both** editors: `@tiptap/extension-table`,
   `table-row`, `table-header`, `table-cell` (configure `resizable` as desired).
2. Make sure the render-layer `DOMPurify.sanitize` call keeps table attributes
   (e.g. `colspan`, `rowspan`, and the `colgroup`/`col` width markup TipTap
   emits) — add to `ADD_ATTR`/allowed tags as needed; mirror in the server
   `SANITIZE_OPTS` (`colgroup`, `col`, `colspan`, `rowspan` are not all allowed
   today).
3. Authoring affordances: slash-command (`/table`) and/or bubble-menu controls to
   insert/edit tables; basic add/remove row & column.
4. Confirm Markdown tables (gfm) and pasted HTML tables both parse into the new
   node; add tests to `lib/rich-text.test.ts` and a render check.
5. CLI/API need no change — they already send Markdown/HTML; this is purely a
   rich-text rendering capability. Note it in `docs/frontend.md` once shipped.

**Watch-outs.** Tables widen content; check mobile/overflow styling and the
seamless vs bordered editor variants. Keep the four-surface sync contract in mind
(CLAUDE.md) — the vocabulary doesn't change, but `docs/frontend.md` should
document the new node.

---

## Other gaps noted while building file-embedding (2026-06-23)

Lower priority; capture so they aren't lost.

- **Native `<video>` / `<audio>` / `<iframe>` are dropped on render.** Only the
  `fileAttachment` node (`data-type="file-attachment"`) renders media; raw HTML5
  media tags an agent might send are stripped (no matching TipTap node). Either
  document this hard rule for agents (done in the changelog/manifest) or add real
  support for native media/embeds later.

- **No standalone server upload convenience for raw API.** Direct-API agents do
  two calls (upload, then reference the url). Fine as a REST pattern, but a
  combined "create with file" endpoint could be added if demand appears.
