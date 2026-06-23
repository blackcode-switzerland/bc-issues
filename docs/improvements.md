# Improvements / backlog

Forward-looking notes on known gaps and things worth doing later. Unlike
[`next-fixes.md`](./next-fixes.md) (a *resolved* historical friction log), this
file is the place to **add** items as we discover them and refer back when we
pick them up. Newest first. When an item ships, move a one-line note to
[`api-changelog.md`](./api-changelog.md) and delete it here.

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

- **Several API responses expose the internal (global) issue id.** Confirmed on
  two surfaces, both contradicting the "one id = the workspace #number" contract:
  - **Attachments** — `bk issue attach … --json` / `POST …/attachments` returns
    `"issue_id": <internal id>` (observed `482` for issue `#25`).
  - **Comments** — `POST …/issues/{id}/comments` returns `"parent_id"` **and**
    `"issue_id"` as the internal id (observed `485` for issue `#28`, 2026-06-23).
  Fix: the comment + attachment serializers should map the parent reference to the
  workspace `#number` (or drop the raw internal field). Audit the rest of the
  secondary entities (project updates, watchers, activity) for the same leak —
  grep responses for `issue_id` / `parent_id` / `project_id` that aren't run
  through the public serializer (`lib/api/serialize.ts`).

- **`fileAttachment` node markup is defined in two places.** The server emits it
  (`upgradeUploadedMedia` in `lib/rich-text.ts`) and the editor parses it
  (`buildFileAttachment` in `components/rich-text-editor.tsx`). They must stay in
  sync (attribute names + `data-content-type` branching). Consider a single
  shared constant/spec if it grows.

- **CLI direct-Blob upload is pinned to Vercel's wire protocol** (`x-api-version: 7`
  in `cli/internal/client/client.go` `uploadViaBlob`). If `@vercel/blob` bumps its
  protocol, the Go path must follow. Maintenance liability, not a bug.

- **No standalone server upload convenience for raw API.** Direct-API agents do
  two calls (upload, then reference the url). Fine as a REST pattern, but a
  combined "create with file" endpoint could be added if demand appears.
