# Keeping the CLI in sync with the backend

A practical guide for deciding **whether a backend change requires a CLI update**, and **what to change** when it does.

The CLI (`bk`) is a Go HTTP client that lives in [`/cli`](../cli) and talks to the same `/api/*` routes the web app uses. It is loosely coupled to the backend — but the coupling that exists is sharp. This doc tells you where it bites.

---

## TL;DR — the decision table

After you change something on the backend, find the row that matches and act accordingly.

| Backend change | CLI needs update? | What to update |
|---|---|---|
| Add a new field to a response (additive) | No | — |
| Rename a JSON field on a response | **Yes** | `cli/internal/client/types.go` |
| Change a field's type (e.g. `int` → `string`) | **Yes** | `cli/internal/client/types.go` |
| Make a previously-optional response field always present | No (but you can drop the `*` from the Go type if you want) | `types.go` (optional cleanup) |
| Remove a response field the CLI doesn't read | No | — |
| Remove a response field the CLI reads | **Yes** | `types.go` + any command that prints it (`cli/internal/commands/*.go`) |
| Add a new endpoint | No (unless you want a `bk` command for it) | `client.go` + new file in `commands/` if exposing it |
| Rename, move, or remove an endpoint | **Yes** | `cli/internal/client/client.go` (path string) |
| Change HTTP method of an endpoint | **Yes** | `client.go` (method name in the helper call) |
| Add a new field to a **request** body | No, unless you want CLI users to be able to set it | `types.go` + the relevant command flag in `commands/*.go` |
| Add a **required** field to a request | **Yes** | `types.go` (add field) + `commands/*.go` (add flag, mark required) |
| Rename a request field | **Yes** | `types.go` (JSON tag) |
| Change query-string parameter names (e.g. `?project_id=` → `?projectId=`) | **Yes** | `client.go` (the `url.Values` keys) |
| Tighten validation, change error wording | No | — (CLI surfaces `{error, suggestion, details}` generically) |
| Change error status codes (e.g. 400 → 422) | Usually no | — (CLI treats anything `>= 400` as error) |
| Add a new permission check (e.g. require admin) | No, but expect 401/403 from existing calls | — |
| Change auth scheme (header name, token format) | **Yes** | `client.go` (`do()` method) + maybe `login.go` |
| Add API versioning (e.g. move to `/api/v1/*`) | **Yes** | `client.go` — every path string |
| Change the upload contract (multipart field name, response shape) | **Yes** | `client.go` `UploadFile` + `types.UploadResponse` |

When in doubt, run the smoke test at the bottom of this doc.

---

## Mental model

```
Backend                         CLI
─────────────────────           ───────────────────────────────────
Route paths   ───────matches───► cli/internal/client/client.go
HTTP methods  ───────matches───► (one method per endpoint)
Query params  ───────matches───► (url.Values keys)
                                 
Request JSON  ───────matches───► cli/internal/client/types.go
Response JSON ───────matches───► (struct fields with `json:"…"` tags)
                                 
Auth header   ───────matches───► client.go `do()` — Bearer token
Error shape   ───────matches───► client.go `APIError`
```

Two files do almost all the work:

- **`cli/internal/client/client.go`** — every HTTP call. Paths, methods, query strings live here.
- **`cli/internal/client/types.go`** — every Go struct that gets serialized to or deserialized from JSON. Field names + types must match the backend exactly.

A third area matters when you're adding **new user-facing functionality**:

- **`cli/internal/commands/*.go`** — Cobra command definitions. One file per resource (`project.go`, `issue.go`, `task.go`, …). This is where new flags / subcommands get wired up.

---

## What does *not* require a CLI update

These are real backend changes the CLI absorbs automatically:

- **Adding fields to response JSON.** Go ignores unknown fields by default, so adding `archived_at` to a project response is invisible to the CLI until someone wires it in.
- **Changing how data is stored or computed** as long as the JSON shape over the wire is the same. Switching from raw SQL to Drizzle, adding caching, denormalizing — none of it matters to the CLI.
- **Tightening or relaxing validation** as long as the error envelope (`{error, suggestion, details}`) is preserved.
- **Cosmetic error message changes.** The CLI prints whatever string the server returns.
- **Adding new endpoints.** Existing CLI commands keep working; you just don't get a `bk` command for the new thing until you add one.
- **Adding new permissions or rate limits.** Calls start returning 401/403/429; the CLI surfaces them — it doesn't silently misbehave.

If a backend change *only* falls into the categories above, you can ship without touching the CLI.

---

## What absolutely requires a CLI update

Anything that breaks one of these contracts:

1. **The path of an endpoint the CLI already calls.** Search `client.go` for `/api/` to see every path the CLI knows about.
2. **The HTTP method of an endpoint the CLI already calls.** GET, POST, PATCH, DELETE — must match.
3. **A JSON field name** the CLI reads or writes. Open `types.go`, find the `json:"foo"` tag, and update it.
4. **A required field** on a request the CLI sends. If the server now requires `priority` on `POST /api/issues`, the CLI's `CreateIssueRequest` must include it and the command must accept a flag.
5. **A field's JSON type.** Go decodes strictly — turning an `int` into a `string` will fail at decode time.
6. **The auth scheme.** If you change the header name, the token prefix, or the validation logic, `client.do()` and possibly `login.go` need to follow.
7. **The upload contract.** The CLI's `UploadFile` checks `GET /api/upload` (`{blob}`): with a Blob store it uploads **client-direct** (token handshake at `POST /api/upload/blob`, then a single PUT straight to `blob.vercel-storage.com`, mirroring `@vercel/blob`'s wire protocol — pinned to `x-api-version: 7`); otherwise it POSTs multipart (`file` field) to `/api/upload`. Both read back `{url, filename, size, contentType}`. If the Blob wire protocol bumps (api-version/headers), `uploadViaBlob` in `client.go` must follow. Size cap (100 MB) lives in `lib/upload.ts`.
8. **Inline file embedding.** The `--file` flag (on `issue/task/project create` and `issue comment`) uploads via `UploadFile`, then appends `client.EmbedMarkdown(up)` to the body — `![name](url)` for images, `[name](url)` otherwise. The server's `toRichTextHtml` (`upgradeUploadedMedia`) rewrites uploaded-origin urls into TipTap nodes, so embedding stays markup-free on the client. If the embed Markdown shape or the server's url-detection changes, keep `EmbedMarkdown` (Go) and `upgradeUploadedMedia` (`lib/rich-text.ts`) in sync. `--attach` (issue-only) is unchanged — it writes to the attachments table, not the body.

---

## The workflow when you need to update the CLI

A repeatable five-step process:

### 1. Find every spot in the CLI that touches what you changed

```bash
# From repo root:
grep -rn "/api/issues" cli/internal       # find endpoint paths
grep -rn "assignee_id" cli/internal       # find a JSON field
grep -rn "project_id"  cli/internal       # find a query param
```

### 2. Update `types.go` for any JSON shape change

Each struct field has a `json:"…"` tag — that's what the backend sees. Example: if you rename `assignee_id` → `assigneeId` on the backend:

```go
// Before
AssigneeID *int `json:"assignee_id"`
// After
AssigneeID *int `json:"assigneeId"`
```

Optional vs. nullable:

- `*int` / `*string` with `omitempty` = the field can be omitted from JSON. Use for optional response fields and create-time inputs.
- `json.RawMessage` with `omitempty` = the field can be omitted **or** sent as `null`. Use for "clear-to-null vs leave-alone" semantics on PATCH endpoints (see `UpdateIssueRequest` — `assignee_id`, `task_id`, `start_date`, `due_date` all use this pattern).

### 3. Update `client.go` for any path / method / query-string change

The methods are organized as:

- **Reads** (`Whoami`, `ListProjects`, `GetIssue`, …): use `c.get(path, &out)`.
- **Creates / updates** (`CreateIssue`, `UpdateProject`, …): use `c.postJSON` / `c.patchJSON`.
- **Deletes** (`DeleteIssue`, `RemoveProjectMember`, …): use `c.deleteJSON`.

Pattern for adding a new endpoint:

```go
func (c *Client) ArchiveProject(id int) error {
    return c.postJSON(fmt.Sprintf("/api/projects/%d/archive", id), nil, nil)
}
```

### 4. Wire it into a command if user-facing

Open the file that matches the resource — `commands/project.go`, `commands/issue.go`, etc. — and either:

- Add a new subcommand under `newProjectCmd()` (cobra pattern), or
- Add a flag to an existing subcommand and pass it into the request struct.

Keep the command thin — parse flags, call the client method, print the result via `output/`.

### 5. Smoke-test against your local dev server

```bash
cd cli
make build                                    # or: go build -o bk ./cmd/bk
./bk login --server http://localhost:3000     # only if auth shape changed
./bk whoami                                   # baseline check
./bk project list
./bk issue list --project 1
./bk issue create --project 1 --title "smoke"
./bk issue edit 1 --status done
./bk activity --limit 5
```

If your change touched a specific area, hit that area too:

- Changed uploads? `./bk issue attach 1 --file ./path/to/file.png`
- Changed tasks? `./bk task list --project 1`
- Changed undo? `./bk undo`

---

## Examples by change shape

### Example A — purely additive

> "I added `archived_at` to the project response so the dashboard can show archived projects."

**CLI impact:** none. The CLI doesn't read `archived_at`, and Go ignores unknown fields. Ship the backend; the CLI keeps working.

If later you want `bk project list` to display archive status, that's a CLI feature change — add `ArchivedAt *string \`json:"archived_at,omitempty"\`` to `types.Project` and update the table renderer.

### Example B — request rename

> "I renamed the create-issue field from `assignee_id` to `assignee` and now accept either an int (user id) or a string (email)."

**CLI impact:** `types.CreateIssueRequest` and `types.UpdateIssueRequest` must rename the field, and the type stays `json.RawMessage` since you now accept multiple types. Then in `commands/issue.go` decide how `--assignee` is parsed — probably accept both `--assignee 42` and `--assignee user@x.com`.

### Example C — new endpoint, no CLI command yet

> "I added `POST /api/issues/[id]/duplicate` that clones an issue."

**CLI impact:** none required. Existing commands keep working. When you want a CLI surface, add:

```go
// client.go
func (c *Client) DuplicateIssue(id int) (*Issue, error) {
    var iss Issue
    if err := c.postJSON(fmt.Sprintf("/api/issues/%d/duplicate", id), nil, &iss); err != nil {
        return nil, err
    }
    return &iss, nil
}

// commands/issue.go
// add a `bk issue duplicate <id>` subcommand wired to client.DuplicateIssue
```

### Example D — endpoint path moved

> "I'm versioning the API. Everything moves from `/api/*` to `/api/v1/*`."

**CLI impact:** every path in `client.go` changes. Easiest fix: define a constant.

```go
const apiBase = "/api/v1"
// then: c.get(apiBase + "/projects", &out)
```

Bump the `User-Agent` (e.g. `bk-cli/0.2`) so server logs can tell old clients apart from new ones, and consider rejecting old clients server-side once you're past the transition.

### Example E — auth header change

> "I'm replacing `Authorization: Bearer …` with `X-API-Token: …`."

**CLI impact:** `client.do()` (the one spot that sets the header) and possibly `commands/login.go` if the login flow changes (e.g. you switch from token-pasting to a different handshake).

### Example F — required-field promotion

> "Creating an issue now requires `priority` (was optional)."

**CLI impact:** `CreateIssueRequest.Priority` is already there but with `omitempty`. Remove the omitempty if priority must always go on the wire. In `commands/issue.go`, mark `--priority` as required (`cmd.MarkFlagRequired("priority")`) so the CLI fails fast with a clean error instead of letting the server reject the call.

---

## File-by-file cheat sheet

When you're not sure where to start, use this table:

| What you changed on the backend | File to open in `cli/internal/` |
|---|---|
| JSON field name or type on any response | `client/types.go` (find the struct) |
| Required / optional shape of a request body | `client/types.go` (find the `*Request` struct) |
| Endpoint path | `client/client.go` (search for the old path) |
| HTTP method on an endpoint | `client/client.go` (the `c.get` / `c.postJSON` / `c.patchJSON` / `c.deleteJSON` call) |
| Query-string parameter name | `client/client.go` (the `url.Values` keys for the method that calls it) |
| Auth header / token format / login flow | `client/client.go` (`do` method) + `commands/login.go` |
| Upload contract | `client/client.go` `UploadFile` / `AttachToIssue` + `types.UploadResponse` |
| Error envelope (`{error, suggestion, details}`) | `client/client.go` `APIError` |
| Adding a new user-facing command | new function in `commands/<resource>.go`, registered in `commands/root.go` |
| Output format / column tweaks | `internal/output/` (table / json / yaml renderers) |

---

## Habits that reduce future sync work

1. **Prefer additive changes on existing endpoints.** Add new fields, don't rename. Add new endpoints, don't repurpose old ones.
2. **Treat the API JSON shape as a public contract.** If you're tempted to rename a field for readability, it's not free — the CLI (and any external scripts using the same API) pay for it.
3. **Version the API when you anticipate breaking changes.** Move new versions under `/api/v2/*` instead of mutating `/api/*` in place. The CLI can then support both by bumping `apiBase`.
4. **Keep the error envelope stable** (`{error, suggestion, details}`). The CLI handles this uniformly; deviating means custom handling per endpoint.
5. **Run the smoke test at the end of a backend PR** if it touched any handler under `app/api/`. Three minutes of `bk` commands catches 95% of sync bugs.

---

## Smoke-test script

Drop this into `scripts/cli-smoke.sh` (or run line by line) any time you change a backend handler. It exercises the main endpoints and surfaces decode errors / 4xx / 5xx loudly.

```bash
#!/usr/bin/env bash
set -euo pipefail

BK=./cli/bk
SERVER="${SERVER:-http://localhost:3000}"

(cd cli && make build)

$BK whoami
$BK project list
PROJECT_ID=$($BK project list --json | jq '.[0].id')

$BK issue list --project "$PROJECT_ID" --limit 5
ISSUE_ID=$($BK issue create --project "$PROJECT_ID" --title "smoke $(date +%s)" --json | jq '.id')
$BK issue view "$ISSUE_ID"
$BK issue edit "$ISSUE_ID" --status in_progress
$BK issue comment "$ISSUE_ID" --body "smoke comment"
$BK issue activity "$ISSUE_ID"

$BK task list --project "$PROJECT_ID"
$BK activity --limit 5
$BK undo --count 1     # rolls back the status change above

echo "✓ CLI smoke test passed"
```

If any line fails with a decode error (`decode response: ...`) you have a JSON shape mismatch — open `types.go`. If a line fails with `(404)` or `(405)`, you have a path or method mismatch — open `client.go`.

---

## Related docs

- [`docs/cli.md`](./cli.md) — what the CLI does and how to use it.
- [`docs/backend.md`](./backend.md) — the API surface the CLI consumes.
- [`cli/README.md`](../cli/README.md) — CLI-local README with build instructions.
