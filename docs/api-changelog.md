# API & CLI Changelog

Breaking and notable changes to blackcode issues and the `bk` CLI. Newest first.
If a command that used to work now fails, check here first.

For how the CLI **works** (rather than what changed), run **`bk guide`** — the
complete usage guide, embedded in the binary, so it always describes the version
you are running. For live values (vocabularies, limits, your workspaces), run
**`bk meta`**.

Surfaced at: the [`/changelog`](/changelog) web page, `GET /api/changelog`
(JSON or `?format=markdown`), and `bk changelog`.

> **Process rule:** every change to a route or user-facing feature must add a
> dated entry here. Timestamp it and describe what changed and how to adapt.

---

## 2026-08-03 — **BREAKING (documentation):** the `bk` CLI is now the only supported interface

**Nothing was removed or changed at the route level. Every existing HTTP
integration keeps working today.** What has been withdrawn is the *documentation*
and the *support promise*. Read that sentence before reacting to the rest.

### What changed

The product used to describe itself to agents through **seven hand-maintained
surfaces** that all had to agree: the REST routes, a 1,290-line hand-written
OpenAPI spec, the CLI, `/api/meta`, a 77-line per-page manifest, ~2,100 lines of
docs, and this changelog. Six were copies of the same facts, and they had already
drifted — the manifest claimed uploads accept "any file type" (SVG is rejected),
the platform reference described a `GET /api/upload` response field that never
existed, and its pinned CLI version was a release behind.

There is now **one door (`bk`) and two sources of truth**:

| Kind of knowledge | Where | Why there |
|---|---|---|
| How the tool behaves — flags, exit codes, workflows | `bk guide`, embedded in the binary | It describes *the binary you are running*. A guide fetched from a server could describe a `--flag` your copy doesn't have. |
| What the data is right now — vocabularies, limits, workspaces | `bk meta`, fetched live | Changes without a CLI release. |

### Retired

- **`GET /api/openapi.json`** and **`GET /api/docs`** now return **`410 Gone`**
  with the standard error envelope and an actionable `suggestion`, so an agent
  can recover in the same run rather than treating it as a bug. They stay
  indefinitely: their audience is an agent working from stale context that still
  has these URLs in its prompt, and that can turn up at any time.
- **The pinned "Platform Reference" baseline** is gone. `GET /api/changelog` no
  longer returns a `reference` field; it returns `reference_moved_to` instead, so
  a client built against the old shape gets an explanation rather than
  `undefined`. `bk changelog --reference` is deprecated and prints a pointer to
  `bk guide`.
- **The per-page agent manifest** dropped from 77 lines to 8. `/llms.txt` is now
  an install funnel, not a reference.

### New in CLI 1.9.0

```bash
npm install -g @blackcode_sa/bc-issues@latest

bk guide              # the complete usage guide for THIS binary — offline, no auth
bk guide --list       # topic slugs + one-line summaries
bk guide <topic>      # one topic; unknown slug exits 2 with the valid list
bk guide --json       # { version, topics: [{ slug, title, summary, body }] }

bk skill install      # write the agent skill file (--format agents-md for AGENTS.md)
bk skill check        # exit 0 = current, exit 9 = something is behind
bk skill sync         # the one command to run when anything drifts
bk skill path | uninstall
```

Also new, closing real capability gaps rather than faking parity:

- **`bk label edit <id>`** — renaming or recolouring a label was previously
  reachable only from the web UI.
- **`bk undo --log`** — preview what `bk undo` would roll back, without doing it.
- **`bk issue watch <id> --status`** — report whether you are watching, without
  toggling it.
- **`bk workspace delete <slug> --confirm <slug>`** — deleting a workspace was
  previously web-UI only, which left an agent that can *create* a workspace
  unable to clean one up. Guarded harder than the usual `--yes`: `--confirm`
  must repeat the target back, and it is required even under `BK_NO_PROMPT=1`,
  because that is exactly how agents run. Takes an explicit argument — it never
  falls back to your active workspace. Owner only, and irreversible: this is not
  the Trash and `bk undo` cannot roll it back.

Exit code **9** is new: "update available", returned by `bk skill check` / `bk
skill sync` so an agent can branch on it without parsing stderr.

### Error reporting fixes (behaviour change — check any exit-code branching)

Three defects that all undercut branching on exit codes:

- **A mistyped subcommand used to exit `0`.** `bk workspace notacmd` printed help
  and reported success, which an agent reads as "it worked". It now exits **2**
  with `unknown command "notacmd" for "bk workspace"`. This also un-blocked the
  deprecation hints: `hint:` could never fire for a *renamed subcommand*, because
  the failure it keys off never happened.
- **Argument-count errors returned `1` instead of `2`.** `bk issue view` with no
  id now exits **2**, matching the documented "bad usage" row.
- **Every error printed twice** — once by cobra, once by the CLI — on the same
  stderr an agent parses. Now printed once, as `error:` plus an optional `hint:`.

`bk <group>` with no arguments still prints help and exits 0; that is a
legitimate "what can this do?".

### `bk meta` / `GET /api/meta` carries more

Three new derived blocks. Nothing here is hand-typed — each value is imported
from the module that enforces it, so it cannot disagree with the code:

- **`limits`** — `upload_max_bytes`, `issue_title_max`, `project_name_max`,
  `task_name_max`, `label_name_max`, `workspace_name_max`, `token_name_max`,
  `profile_name_max`, `profile_tagline_max`, `invite_email_max`,
  `undo_max_count`, `page_size_default`, `page_size_max`.
  (`workspace_name_max` = 80 has been enforced all along and was documented
  nowhere.)
- **`media`** — which MIME prefixes render inline, which types get View+Download,
  and `blocked_mime_types` (currently `image/svg+xml`). The old claim that
  uploads accept "any file type" was wrong.
- **`cli`** — `latest_version`, `min_version`, `package`, `install`, `update`.

`conventions` shrank to pointers; the prose it carried is now in `bk guide`.
`GET /api/upload` also gained the numeric `maxBytes` and `blockedMimeTypes` that
the old documentation claimed it already returned.

### Deprecation signals

Every response **to a non-CLI caller** carries:

```
X-BK-Migration: <host>/agent-updator
Warning: 299 - "The HTTP API is no longer a supported interface. Use the bk CLI: npm install -g @blackcode_sa/bc-issues && bk skill install"
```

There is no `Sunset` header and no cutover date. The routes stay where they are;
they are simply no longer a surface we document or support.

Requests made through `bk` are **not** warned — it is the supported interface,
and a warning its users can't act on just teaches agents to ignore headers.

### How to adapt

```bash
npm install -g @blackcode_sa/bc-issues
bk login
bk skill install
bk guide
```

Full migration notes, including where each piece of the old documentation went:
[/agent-updator](/agent-updator).

### Versions

CLI latest **1.9.0**; minimum supported stays at **1.8.7** for now. A 1.8.x
client still works — it just has no `guide` or `skill` commands. The floor will
be raised to 1.9.0 after 1.9.0 has soaked; both values are env-overridable
(`BK_CLI_LATEST` / `BK_CLI_MIN`) so the floor can be rolled back without a
redeploy.

---

## 2026-07-28 — Markdown containing `<placeholder>` tokens now renders correctly

**Bug fix. Not breaking for well-formed clients — but it changes how some
already-stored content is interpreted, and it fixes silent data loss.**

### What was wrong

Rich-text fields (comments, issue/task/project descriptions, project-update
bodies) accept Markdown or HTML. The server decided which one it had received by
looking for *any* HTML-looking tag — the regex matched any `<word>` anywhere in
the document.

That meant a perfectly ordinary Markdown document containing an angle-bracket
placeholder — `` `clinicBranchId != <clinicId>` ``, `<uid>`, `Promise<void>`,
`<your-token>` — was classified as HTML and stored **verbatim, unparsed**. On
render the browser then treated it as HTML, with three visible symptoms:

- **No Markdown was applied at all.** `##` headings, `-` lists, `|` tables and
  `**bold**` all stayed literal.
- **The whole document collapsed into one paragraph**, because newlines are
  just whitespace in HTML.
- **The placeholder itself disappeared**, silently dropped by the browser as an
  unknown tag — so `` `clinicBranchId != <clinicId>` `` displayed as
  `` `clinicBranchId != ` ``. This was real content loss, not only a formatting
  problem.

This hit agents and CLI users hardest, since technical write-ups routinely
contain placeholders and generics.

### What changed

A document is now treated as HTML only when it contains a **block-level**
container tag:

```
p, div, h1–h6, ul, ol, li, blockquote, pre, table, thead, tbody, tr, th, td
```

Inline tags (`<b>`, `<em>`, `<br>`, `<img>`, `<a>`, `<span>`, …) no longer flip
the document to the HTML path. Markdown passes raw inline HTML through
untouched, so such documents now get **both** proper Markdown structure and
their inline tags.

Second, on the Markdown path an angle-bracket token that isn't recognized markup
is now **escaped into visible text instead of being dropped**. Previously
`Promise<void>` written outside a code span lost its `<void>`. Both of these now
survive, in prose and in code spans alike:

```
Returns Promise<void> and takes Array<string>, id is <uid>.
```

A side effect worth knowing: a `<script>` tag written in Markdown prose now
displays as escaped, inert text rather than silently vanishing. It is text, not
markup, on every render path — nothing executable survives.

Nothing about the request or response shape changes — same fields, same
envelopes, same endpoints. If you were already sending clean Markdown or clean
editor HTML, you will simply see correct rendering.

```bash
# Previously rendered as one literal blob with `<clinicId>` missing.
# Now renders as a heading, a list and a table, with the placeholder intact.
bk issue comment '#327' --body-file ./findings.md
```

### Also in this change: client-supplied HTML is now sanitized

HTML input previously skipped server-side sanitization entirely — it was stored
as sent, and only the read-only display component sanitized on render.
Descriptions, however, are rendered through the *editable* editor, which did not
sanitize. So HTML posted to a description through the API reached the browser
unsanitized.

Now **both** paths are sanitized on write, and both render paths sanitize too.
`<script>`, `on*` event handlers and `javascript:` URLs are stripped.

The allowlist covers everything the editor emits, so this is lossless for real
content — task lists (`ul[data-type=taskList]`,
`li[data-type=taskItem][data-checked]`), mentions
(`span[data-type=mention][data-id][data-label]`), tables including `colgroup`
column widths and `colspan`/`rowspan`, and file-attachment nodes. `style` is
narrowed to inert layout properties (`width`, `min-width`, `height`,
`text-align`).

**How to adapt:** if you post HTML directly, keep to that vocabulary — anything
outside it is now dropped on write rather than at render.

### Note on existing content

This fix applies to content written **from now on**. Rows already mangled stay
as they are; they were stored in their broken form. Re-sending the original
Markdown (e.g. `bk issue edit-comment …`) repairs a row.

---

## 2026-07-06 — Smarter, ranked search on the Issues/Tasks/Projects listings

UI-only change, no API/CLI surface affected (the REST endpoints, OpenAPI spec,
and `bk` CLI are unchanged — their `?search=` param already does a separate,
unrelated `ILIKE` match and is not used by these listing pages).

- The listing search box (`lib/listing-search.ts`) now scores matches instead
  of only filtering: exact > prefix > word-boundary substring > mid-word
  substring > fuzzy (typo-tolerant) match, per search term per field, with
  fields weighted so an identifier or title/name hit outranks a hit only in an
  assignee/lead email or description.
- Results are sorted best-match-first while searching (with the Sort control
  left on "Manual"); picking an explicit sort still overrides relevance order.
- Identifier search (`#123` or `123`) is unchanged in behavior but now scores
  highest, so searching an ID reliably surfaces that exact item first even
  when the number also appears elsewhere (e.g. in a title).
- Typos are now tolerated for terms of 3+ characters via a small bounded edit
  distance, so e.g. `onboardng` still finds "onboarding" — but never for purely
  numeric terms, so an ID search like `122` can't fuzzy-match an unrelated `112`.
- **Fixed:** the Tasks and Projects listing rows displayed the raw internal
  `id` in their `#N` badge, while search and click-through navigation both
  used `seq ?? id` (the same convention Issues already displayed). Whenever a
  task/project's `id` and `seq` diverged (the common case — they're allocated
  from unrelated counters), the number shown on screen couldn't be found via
  search. All three listings now consistently display and search `seq ?? id`.

## 2026-07-03 — Self-service recovery hints (breadcrumb headers + CLI hints)

So an agent that hits a wall can find its own way back, every surface now points
at how to get current — at the moment it's useful, without adding noise to normal
success paths. All additive.

- **Response headers on every API response** (success and error): **`X-BK-Help`**
  (→ `/agent-updator`) and **`X-BK-Changelog`** (→ `/changelog`), alongside the
  existing `X-BK-CLI-Latest` / `X-BK-CLI-Min`. They're out-of-band (never in the
  body), so a client that ignores them pays nothing. The response envelopes are
  unchanged.
- **`bk` prints a one-line `hint:` to stderr** only when you're actually stuck —
  an auth failure (run `bk login`), a drift-smelling `400`/`404`/`422` (run
  `bk changelog` / see `/agent-updator`), or an unknown command/flag (likely
  renamed or removed). stderr only, so `--json` stdout stays clean. Unknown
  command/flag now also exits `2` (usage) instead of `1`.

## 2026-07-03 — Changelog, platform reference & the agent-updator guide

The changelog is now a first-class, multi-surface product feature instead of a
plain doc file. Three things shipped, all additive:

- **`/changelog`** — a public web page: a pinned **Platform Reference (baseline)**
  (`docs/platform-reference.md`) covering the entire API + CLI surface, data
  types, rules, and warnings at the current release, followed by this dated log.
  Linked from the site footer.
- **`GET /api/changelog`** — public, unauthenticated. Returns
  `{ cli_latest_version, cli_min_version, reference: { markdown, html }, entries:
  [{ date, title, markdown, html }] }`. `?format=markdown` returns the whole
  thing as one raw Markdown document.
- **`bk changelog`** — lists dated changes (`--json`/`--yaml` for machines);
  `bk changelog --full` prints the whole reference + log; `bk changelog
  --reference` prints just the baseline.

Also new: **`/agent-updator`** — a public guide that tells an agent (or an
outdated agent *skill*) how to get current: which interface to use, how to
install/update the CLI, OS-specific gotchas (Windows UTF-8), and to read the
changelog and re-check it periodically. Hand this URL to any agent whose
integration has drifted.

The `GET /api/meta` `conventions.changelog` pointer and the agent manifest now
point at `/changelog` (the old `/docs/api-changelog.md` url was never actually
served).

## 2026-07-03 — Move / copy items between workspaces

New endpoint **`POST /api/workspaces/{ws}/move`** transfers projects, tasks, and
issues (referenced by their `#number`) from `{ws}` (the source) into another
workspace the caller also belongs to. Additive — no existing behaviour changed.

Body: `{ target, mode: "move" | "copy" (default "move"), projects?: number[],
tasks?: number[], issues?: number[], cascade_tasks?: boolean (default true),
cascade_issues?: boolean (default true) }`. `move` copies then bins the source;
`copy` leaves the source in place.

It runs as a **single transaction** — on any error nothing is written to the
target and the source is untouched, so no data can be lost. Items get fresh
`#number`s in the target, labels are matched/created by name, and comments,
attachments, watchers, assignees, project members and updates all come along.
User references (assignee/reporter/lead/owner/watcher/member/`@mention`) not in
the target's membership are dropped and returned under `adjustments`; a parent
link (project/task) left out of the same transfer is cleared.

CLI: **`bk move --to <ws> --project N …`** and **`bk copy --to <ws> …`**
(`--project`/`--task`/`--issue` repeatable; `--cascade-tasks` / `--cascade-issues`).

> **Encoding note (agents/scripts):** all API text is UTF-8. When scripting a
> bulk import/export/move, keep the environment UTF-8 — a non-UTF-8 console
> (commonly Windows `cmd`/PowerShell without `chcp 65001`) silently corrupts
> non-ASCII characters into mojibake (`é`→`Ã©`, `—`→`ΓÇö`). Prefer JSON bodies
> over round-tripping text through a terminal. See `docs/cli.md` →
> "Character encoding (UTF-8)".

## 2026-07-01 — `GET /api/meta` now lists all your workspaces (pick by name, not id)

`GET /api/meta` gained a **`workspaces`** array: every workspace the caller
belongs to, each `{ id, name, slug, role, is_active }`. This is additive — no
existing field changed.

Why: workspace `id`s are opaque sequential integers, so an agent that only knew
the numeric id had no reliable way to tell which team a workspace was, and could
create issues in the wrong workspace. Agents should now **choose the target
workspace by its human-readable `name`/`slug`**, then address it as
`/api/workspaces/{slug}/…` (the `{ws}` segment still accepts slug or id — prefer
the slug). `active_workspace` is only a default, not necessarily where the user
means to write.

The same list is also available on its own at `GET /api/workspaces`, and via the
new **`bk meta`** CLI command (the CLI mirror of `GET /api/meta`) or
`bk workspace list` (switch with `bk workspace use <slug>`, or target one command
with `bk --ws <slug> …`). The embedded agent manifest and the OpenAPI `Meta`
schema were updated to say the same thing.

---

## 2026-06-24 — Tables render natively; uploaded video/audio embeds

Rich-text fields (descriptions, comments, project-update bodies) now render
**tables** end-to-end. No API/CLI change is required — a **GFM Markdown table**
(or an HTML `<table>`) sent in any body now displays as a real table in the web
UI, the same way images and file attachments already did. The server and
render-layer sanitizers were widened to keep the table markup (`colgroup`/`col`,
`colspan`/`rowspan`).

Also: a raw HTML5 `<video>`/`<audio>` tag that points at an **uploaded** asset
(`/api/upload` url) is now rewritten into the inline player, matching how
`![](url)` / `[name](url)` already embed. Unchanged hard rules: `<iframe>` and
external (non-uploaded) media are still stripped on render — upload media to
embed it.

---

## 2026-06-23 — Activity feed `entity_id` is the #number

`GET /api/workspaces/{ws}/activity` used to return `entity_id` as the **internal**
serial for issue/task/project events. It now returns the workspace `#number` (the
value you address entities by), resolved per row (trashed items included; a purged
item whose `#number` can't be recovered returns `null`). Other entity types
(comment/label/attachment/workspace/member/invitation) are unchanged — their
`entity_id` is that entity's own id. This also fixes entity-scoped activity on the
web detail pages, which filter by `#number`.

`bk activity` was realigned to the actual event shape at the same time: columns
are now `WHEN / WHO / ACTION / ENTITY / ID` (was the stale
`OPERATION / TABLE / RECORD`, which read fields the endpoint never returned).

---

## 2026-06-23 — Secondary entities no longer leak internal ids

Comments, attachments, and project updates used to return the **internal** serial
id of the work item they belong to, contradicting the "one id = the workspace
`#number`" contract. They now expose the `#number` like everything else:

- **Comments** — `parent_id` is now the parent issue/task/project `#number`. The
  legacy internal `issue_id` field is **no longer returned** (use
  `parent_type` + `parent_id`). Affects `GET`/`POST …/{issues,tasks,projects}/{id}/comments`
  and `PATCH …/comments/{id}`.
- **Attachments** — `issue_id` is now the issue `#number` (was the internal id).
  Affects `GET`/`POST …/issues/{id}/attachments` and `GET …/attachments`.
- **Project updates** — `project_id` is now the project `#number`. Affects
  `GET`/`POST …/projects/{id}/updates`.

Migration: if you parsed `issue_id`/`parent_id` from these responses as a global
id, treat it as the `#number` now (and read comments via `parent_type`+`parent_id`).
The `bk` CLI's legacy `Comment` shape drops `issue_id` in favour of
`parent_type`/`parent_id`. (The activity feed's `entity_id` was given the same
treatment — see the entry above.)

---

## 2026-06-23 — Workspace storage management (uploads ledger + owner cleanup)

Uploaded files are now tracked and can be reviewed and cleaned up. Previously
nothing ever deleted stored files — every upload lived in Blob storage forever.

**New (owner-only) endpoints:**

- `GET /api/workspaces/{ws}/storage` — every file uploaded into the workspace,
  each with `reference_count` + `references` (the issue/task/project/comment/
  project-update bodies and attachment rows that point at it, **including items
  in the recycle bin**), plus `usage_bytes` and `limit_bytes`.
- `DELETE /api/workspaces/{ws}/storage/{id}` — permanently delete a file. Gated
  by a live, system-wide reference scan: refused with **409 `file_in_use`** if
  anything still references it. Only genuine orphans (`reference_count` 0) can be
  removed. Irreversible.
- `GET /api/workspaces/{ws}/attachments` — the workspace-wide attachments table
  (every `attachments` row joined to its issue + uploader).

**CLI:** `bk storage list`, `bk storage rm <id>`, `bk storage attachments`.

**Automatic cleanup.** Hard-deleting a comment/reply or purging an item from
Trash (single, batch, or empty) now automatically removes any file that content
referenced **once nothing else references it** (same live system-wide scan). So
permanently destroying content also frees its storage — no owner action needed.

**Behaviour to know.** *Editing* a file out of a description/comment (without
deleting the item) still does **not** delete the stored bytes — that's
deliberate, so undo and trash-restore stay safe; those files become "Unused"
orphans the owner clears from the Storage page. Uploads made before this shipped
aren't in the ledger yet (a reconcile pass is planned — see improvements.md).

**Internal:** new `uploads` ledger table (written at upload time on every path),
nullable `workspaces.storage_limit_bytes` (base for future quotas, unenforced).

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
