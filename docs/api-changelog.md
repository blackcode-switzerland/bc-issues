# API & CLI Changelog

Breaking and notable changes to the REST API and `bk` CLI. Newest first.
If a request that used to work now fails, check here first.

Surfaced at: `GET /api/meta` (`changelog` field), the OpenAPI description
(`/api/docs`), the embedded per-page agent manifest, and `bk --help`.

---

## 2026-06-23 — CLI: `bk upload` + local-file embedding in descriptions

Two CLI ergonomics additions for attaching files (no API change — both use the
existing `POST /api/upload`):

- **`bk upload <file>...`** — uploads file(s) and prints the url(s). Table output
  is bare urls (pipeable); `--json` returns `[{url,filename,size,contentType}]`.
  Unlike `bk issue attach`, it creates **no** sidebar attachment record.
- **Local-file references in the body** — `--description` / `--description-file`
  (and `--body`, project-update bodies, comments) may reference local file paths
  directly; the CLI uploads each and rewrites it inline. Lets you build a
  *structured* doc (files under specific headings) without harvesting urls by
  hand. Empty link text is auto-filled from the filename.
  - **Paths with spaces or parentheses must be angle-bracketed**:
    `[](</abs/my file (2).mp4>)`. Plain Markdown stops the link destination at
    the first `)`, so `[](/a/foo(1).mp3)` would silently truncate.

This removes the previous awkwardness where the only way to get a url for inline
placement was `bk issue attach` (which also added a sidebar record).

---

## 2026-06-23 — CLI cleanup: removed dead pagination flags

Finishing the 2026-06-22 single-id refactor. The issue/project/task list
endpoints already returned every matching row in one response, but the CLI still
advertised pagination flags that the server ignored. Removed:

- `bk issue list` — dropped `--all`, `--limit`, `--cursor` (output is unchanged:
  it already returned everything; `total` and the `showing X of N` footer stay).
- `bk project list` / `bk project issues` — dropped `--limit`, `--cursor`.

Real keyset pagination is unaffected: `bk activity`, `bk trash list`, and
`bk super-admin errors list` still take `--limit`/`--cursor` with `next_cursor`.
Also removed the long-dead `id:<globalid>` reference form from CLI help/docs (the
form itself stopped working on 2026-06-22) — address items by their `#number`.

---

## 2026-06-23 — Embed uploaded files inline from the CLI / API

You can now attach files **inside** a description or comment (image previews,
video/audio players, file-download cards) from any client — the same result the
web drag-and-drop produces — without knowing any app-specific markup.

**How.** Upload a file, then reference its returned url in the body with plain
Markdown:

- `![name](url)` — images render as inline previews.
- `[name](url)` — any other file (video, audio, pdf, zip, …) renders as a
  player or a download card.

The server (`toRichTextHtml`) recognizes urls that came out of **our** upload
pipeline (Vercel Blob / `/uploads`) and upgrades them to the right rich-text
node automatically. External urls are left as ordinary links/images, so nothing
else changes. Works in `description`, `content` (comments), project summaries,
and project-update bodies.

**CLI shortcuts** (do upload + embed in one call, repeatable):

```
bk issue   create --project 4 --title "Bug"   --file ./screenshot.png --file ./trace.log
bk task    create --project 4 --name  "Spike"  --file ./design.pdf
bk project create --name "Q3"                  --file ./brief.pdf
bk issue   comment 248 --body "see clip" --file ./demo.mp4
bk issue   comment 248 --reply-to 991 --body "thanks"     # threaded reply
```

Note: `bk issue create --attach <file>` is unchanged — it adds to the issue's
**attachments list** (sidebar), which is separate from embedding in the body.
Use `--file` to embed inline; use `--attach` for the attachments list.

---

## 2026-06-23 — Uploads up to 100 MB on every client

- The file-size cap is now **100 MB** (was 50 MB), defined once in `lib/upload.ts`.
- **Large files no longer go through the serverless function** (which caps request
  bodies at ~4.5 MB). All clients upload **client-direct to Vercel Blob** in
  production:
  - **Web / JS** (`@vercel/blob/client`) and the **`bk` CLI** do a token
    handshake at `POST /api/upload/blob`, then PUT straight to Blob storage.
  - **Direct REST consumers** can do the same: `POST /api/upload/blob` with
    `{ "type": "blob.generate-client-token", "payload": { "pathname", "callbackUrl",
    "clientPayload", "multipart": false } }` (Bearer auth) → returns `{ clientToken }`,
    then PUT the bytes to `https://blob.vercel-storage.com/{pathname}` with
    `authorization: Bearer <clientToken>`, `x-api-version: 7`, `x-content-type`,
    `x-add-random-suffix: 1`.
- **Local dev** (no Blob store) still uses multipart `POST /api/upload`.
- Clients pick the path from `GET /api/upload` → `{ blob: boolean }`.

---

## 2026-06-22 — One id per item (workspace `seq`); global id removed

**What changed.** Projects, tasks, and issues are now addressed and returned by
their **workspace-scoped number** (the `#N` shown in the app) — exposed as
`id`. The internal global primary key is no longer exposed anywhere.

**Why.** Previously each item had two numbers (a global id used by the API/CLI
and a per-workspace `seq` shown in the UI), which was confusing. Now there is a
single id everywhere.

### Breaking changes

- **`id` is now the workspace number.** `GET /api/workspaces/{ws}/issues/248`
  fetches issue **#248** in that workspace (not global id 248). Same for
  `projects` and `tasks`, and all their sub-routes
  (`…/issues/{id}/comments`, `…/labels/{lid}`, `…/attachments`, `…/watch`,
  `…/updates`, `…/members`).
- **The `seq` field is gone** from project/task/issue responses — its value is
  now `id`.
- **Relationship fields are workspace numbers too.** `issue.project_id` /
  `issue.task_id` / `task.project_id` are the referenced item's number (not a
  global id). Inputs accept the same: `POST /issues { "project_id": 4 }` means
  project **#4**. (`assignee_ids`, `reporter_id`, `lead_id`, label ids, comment
  ids, user ids are unchanged — they are a different domain.)
- **List endpoints return everything in one response.** Issues lists no longer
  paginate: `GET /issues` returns `{ data, total }` (no `next_cursor`,
  no `limit`/`cursor`). Projects and tasks already behaved this way.
- **Removed routes:** `GET /api/me/locate` and `GET /api/workspaces/{ws}/resolve`
  (no longer needed — address by `id`/seq directly).
- **No legacy id mapping.** Old global-id URLs/links are not redirected.

### CLI

- `bk issue|task|project view|edit|delete <id>` take the **#number**
  (a leading `#` is accepted). The separate global `ID` column is gone from
  `bk issue list`. The `id:<globalid>` reference form was removed.
- `--project <N>` and similar flags take the item's **#number**.
