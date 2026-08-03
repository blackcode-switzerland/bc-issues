# Agent Surface Simplification — Implementation Plan

**Status:** IMPLEMENTED (Phases 0–5, 2026-08-03) · **Owner:** platform · **Created:** 2026-08-03

> Implementation notes, deviations and open questions are appended in **§13** at
> the bottom of this document.

---

## 1. Why we're doing this

Today the product describes itself to AI agents through **seven hand-maintained
surfaces** that must all agree:

| # | Surface | Where | Size |
|---|---------|-------|------|
| 1 | REST routes | `app/api/**` | 77 routes |
| 2 | OpenAPI spec | `lib/openapi/spec.ts` | 1,290 lines, hand-written |
| 3 | `bk` CLI | `cli/` | 27 command groups |
| 4 | `/api/meta` | `lib/work-items.ts` | generated ✅ |
| 5 | Agent manifest | `lib/agent-manifest.ts` → every page + `/llms.txt` | 77 dense lines |
| 6 | Docs | `docs/backend.md`, `docs/cli.md`, `docs/platform-reference.md` | ~2,100 lines |
| 7 | Changelog | `docs/api-changelog.md` | 458 lines |

Six of those seven are hand-written **copies of the same facts**. Every copy is a
drift risk, and drift is precisely what breaks an agent mid-run.

**The target state:**

- Agents talk to us through **one door: the `bk` CLI.** The HTTP API becomes
  private plumbing with no public contract.
- Knowledge that describes *behaviour* ships **inside the CLI binary** (`bk guide`)
  so it can never disagree with the binary the agent is actually running.
- Knowledge that is *dynamic* (enums, workspaces, limits) comes from the server
  live via `bk meta`.
- The user-installed **skill is thin** — a pointer, not a copy — so it does not go
  stale, and when it does, it repairs itself.

**Cost of a feature change, before → after:**

```
before:  route + openapi spec + CLI + manifest + 3 docs + changelog   (7 edits)
after:   route + CLI command (+ guide topic if behaviour changed) + changelog line
```

**Explicit non-goal:** we do **not** support non-agent / third-party HTTP
integrators. Dropping the public OpenAPI contract is a deliberate, accepted
trade-off.

---

## 2. The two core design decisions

Read these before writing any code — every task below follows from them.

### 2.1 Static behaviour lives in the binary. Dynamic data lives on the server.

| Kind of knowledge | Example | Home | Why |
|---|---|---|---|
| **Static** — how the tool behaves | flag names, exit codes, rich-text rules, upload flow, UTF-8 warning | `//go:embed`-ed Markdown inside `bk`, served by `bk guide` | It describes *this binary*. Fetching it from the server would describe a version the agent doesn't have. |
| **Dynamic** — what the data is right now | statuses, priorities, health values, workspace list, upload size cap, allowed MIME families | server, via `bk meta` | Changes without a CLI release. |

This split is the whole trick. A guide fetched from the server would tell an agent
about a `--flag` its local binary doesn't have — worse than being out of date.
Embedded guide + live `meta` is always coherent.

### 2.2 A skill that contains few facts cannot go stale.

The installed skill file must be ~30 lines that say: *"this project uses
blackcode issues; run `bk guide` first; use `bk <cmd> --help`; always `--json`;
if you see an update notice, run `bk skill sync`."*

All the specifics live behind `bk guide`. That's why the skill is identical for
every user and essentially never needs to change.

---

## 3. Phasing

Build the new home for the knowledge **before** demolishing the old one. Never
run the repo with knowledge that exists nowhere.

```
Phase 0  Inventory & freeze          (no code — produce the mapping)
Phase 1  Make `bk` self-describing   (bk guide, richer meta, failure hints)
Phase 2  Skill install + self-update (bk skill install/check/sync)
Phase 3  Demolition + new guardrail  (delete OpenAPI, slim manifest, CLI parity test)
Phase 4  Migrate existing users      (deprecation signals, min-version bump, comms)
Phase 5  Update the repo's own rules (CLAUDE.md, AGENTS.md)
```

Phases 0→3 can ship as one release. **Phase 4 must ship in the same release** —
see §8 for why the ordering inside it matters.

---

## 4. Phase 0 — Inventory & freeze (do this first, it's the safety net)

**Goal:** prove that nothing an agent needs to know is lost.

**Task 0.1 — Build the content map.**
Create `docs/_migration/content-map.md` (temporary, delete after Phase 3). For
every knowledge chunk in the sources below, record: *source file + section →
destination*. Do not start Phase 3 until every row has a destination that exists.

Sources to walk, exhaustively:

- `lib/agent-manifest.ts` — **every key** of `AGENT_MANIFEST` and every bullet of
  `AGENT_MANIFEST_NOTE`. Currently: `recommended_interface`, `api_base`,
  `workspace_scoped_routes`, `auth`, `get_a_token`, `list_envelope`,
  `error_envelope`, `pagination`, `rich_text`, `json_bodies`, `text_encoding`,
  `move_items`, `file_uploads`, `storage`, `discovery`, `staying_current`,
  `choosing_a_workspace`, `cli`, `for_developers`.
- `docs/platform-reference.md` — all 11 numbered sections + subsections.
- `docs/cli.md` — every `###` (esp. "Body / description input convention",
  "Character encoding (UTF-8)", "Nullable field convention", "User-reference
  convention", "Exit codes", "Patterns for agents and scripts", "Robust scripting
  checklist").
- `cli/internal/commands/root.go` — the `rootLong` string, especially the
  "Conventions for agents" block.
- `lib/openapi/spec.ts` — **descriptions and constraints only.** Any `description`,
  `minimum`/`maximum`, `enum`, `format`, or `required` that encodes a rule an
  agent must obey (e.g. max upload size, allowed file types, date formats,
  title length limits). Route shapes themselves are *not* preserved — they become
  private. Rules are.
- `app/agent-updator/page.tsx` — the "get current" instructions.
- `app/llms.txt/route.ts` — the discovery text.

**Task 0.2 — Reconcile against reality.**
Some of the above is already subtly wrong (that's the point of this project). For
each row, verify the claim against the code before copying it forward. Fix, don't
propagate.

**Deliverable:** a table where every row's destination is one of:
`guide topic X` · `bk meta field Y` · `command --help` · `changelog only` ·
`internal dev doc (not agent-facing)` · `intentionally dropped (reason)`.

---

## 5. Phase 1 — Make `bk` self-describing

### Task 1.1 — Create the embedded guide

**New package:** `cli/internal/guide/`

```
cli/internal/guide/
  guide.go            // //go:embed topics/*.md ; lookup + list + render
  topics/
    00-overview.md
    01-install-auth.md
    02-workspaces.md
    03-items.md
    04-rich-text.md
    05-files.md
    06-storage.md
    07-move-copy.md
    08-output-and-exit-codes.md
    09-undo-and-trash.md
    10-encoding.md
    11-pitfalls.md
    12-staying-current.md
```

Rules for topic files:

- Written **for an agent**, not a human: imperative, short, examples over prose.
- Every topic ends with a `Related commands:` line listing the `bk` commands it
  covers, so an agent knows where to go next.
- **Never restate a dynamic value.** Instead of listing statuses, write
  *"run `bk meta` for the current status/priority/health values."*
- File-type/upload rules go in `05-files.md` and must cover: any file type
  accepted; max size (state it as *"see `limits.upload_max_bytes` in `bk meta`"*);
  which types preview inline (image / video / audio), which get View+Download
  (PDF), which get a download card (everything else); the
  `bk upload` → url → `![name](url)` / `[name](url)` embed flow; the
  `--file` one-step shortcut; the angle-bracket rule for paths containing spaces
  or parentheses; and the fact that raw `<iframe>` and external (non-uploaded)
  media are stripped.

**New command:** `cli/internal/commands/guide.go`

| Invocation | Behaviour |
|---|---|
| `bk guide` | Prints the full guide (all topics concatenated, with a header stating the binary version). This is the "read me first" call. |
| `bk guide --list` | One line per topic: slug + one-line summary. |
| `bk guide <topic>` | Prints one topic. Unknown slug → exit 2 with the list. |
| `bk guide --json` | `{ version, topics: [{ slug, title, body }] }` for agents that prefer structured input. |

Register it in `NewRoot()`. It must work **offline and unauthenticated** — no HTTP
call. That is a hard requirement: it's what an agent runs when everything else is
failing.

### Task 1.2 — Extend `/api/meta` to carry every dynamic value

Add to the `/api/meta` payload (and therefore `bk meta`) anything the guide
deliberately refuses to hardcode:

- `limits` — `upload_max_bytes`, and any length/count caps enforced server-side.
- `media` — which MIME families render inline vs. download-card, so `05-files.md`
  can defer to it.
- `cli` — `latest_version`, `min_version` (from `lib/cli-version.ts`).
- keep the existing `workspaces`, `active_workspace`, and the `lib/work-items.ts`
  enums.

Everything here must be **derived**, never hand-typed — sourced from
`lib/work-items.ts`, `lib/cli-version.ts`, and the upload route's own constants.

### Task 1.3 — Make failures self-healing

Two mechanisms, both required.

**(a) CLI-side deprecation table.** New file `cli/internal/commands/deprecations.go`:

```go
// Renamed or removed flags/commands. Keyed by the OLD spelling.
var deprecations = map[string]string{
  "issue --assignee": "renamed to --assign on 2026-07-14",
  // …
}
```

On any usage error (cobra unknown-flag / unknown-command), look up the old
spelling and append to stderr:

```
hint: `--assignee` was renamed to `--assign` on 2026-07-14.
      Run `bk guide` for current usage, or `bk skill sync` to update your agent skill.
```

Add an entry to this table **in the same commit** as any rename/removal. Keep
entries for 2 minor releases, then prune.

**(b) Server-side `suggestion` on errors.** `lib/api`'s `Errors` already supports
a `suggestion` field. Audit every error path so that any 400/404/409 an agent can
realistically hit carries an actionable `suggestion`, and make the CLI print it on
stderr prefixed `hint:`. This is what turns a dead run into a recovered run.

### Task 1.4 — Rewrite `rootLong`

`cli/internal/commands/root.go`'s `rootLong` currently duplicates the manifest.
Cut it to: what `bk` is, the first-run sequence, the global flags, the exit-code
table, the command-group list, and one loud line:

```
Agents: run `bk guide` first — it is the complete, always-current usage guide
for THIS binary. Then `bk meta` to pick your workspace.
```

Everything it currently says about conventions moves into guide topics.

### Phase 1 verification

```bash
cd cli && go build ./... && go test ./...
./bk guide            # full guide, no network, no auth
./bk guide --list
./bk guide files
./bk guide --json | jq '.topics | length'
```

---

## 6. Phase 2 — Skill install and self-update

### Task 2.1 — The skill template

Embed `cli/internal/skill/template.md` via `//go:embed`. Target ~30 lines. Shape:

```markdown
---
name: blackcode-issues
description: Read and write issues, tasks and projects in blackcode issues via the `bk` CLI.
---

# blackcode issues

All access goes through the `bk` CLI. There is no supported HTTP API.

## First, always
1. `bk guide`  — the complete, current usage guide for the installed binary.
2. `bk meta`   — who you are, every workspace you can write to, and the current
                 status/priority/health vocabularies. Pick the workspace by
                 NAME or SLUG, never by numeric id.

## Rules
- Add `--json` to every read command.
- Set `BK_NO_PROMPT=1` for unattended runs.
- Discover flags with `bk <group> <command> --help` before calling.
- Address projects/tasks/issues by their workspace #number.

## Keeping current
If any `bk` command prints an "update available" notice, or a command that used
to work now fails, run `bk skill sync` immediately, then retry.

<!-- generated by bk skill install · cli 1.9.0 · do not edit -->
```

Note there are **no facts** here that can rot — only pointers. The trailing
comment is the version stamp `bk skill check` reads.

### Task 2.2 — `bk skill` commands

New file `cli/internal/commands/skill.go`:

| Command | Behaviour |
|---|---|
| `bk skill install [--dir PATH]` | Writes the rendered template. Default target: `./.claude/skills/blackcode-issues/SKILL.md` if a `.claude/` exists in cwd or an ancestor, else `~/.claude/skills/blackcode-issues/SKILL.md`. Prints the absolute path written. `--dir` overrides. |
| `bk skill path` | Prints where it would write / did write. |
| `bk skill check` | **Local + one cheap HTTP call.** Compares (a) the version stamp in the installed skill vs. the running binary, (b) the running binary vs. `X-BK-CLI-Latest`. Exit 0 = current, exit 9 = update available. Prints a one-line human summary. |
| `bk skill sync` | The one command an agent is ever told to run. Steps: 1) check for a newer binary; if found, print the exact upgrade command (`npm install -g @blackcode_sa/bc-issues@latest`) and exit 9 — **do not self-mutate an npm global install**; 2) if the binary is current, rewrite the skill file from the local template and exit 0. |
| `bk skill uninstall` | Removes the file. |

Also support a non-Claude target: `bk skill install --format agents-md` appends
(or updates, delimited by HTML comment markers) a `## blackcode issues` section
in `./AGENTS.md`. Same content, different container.

**Why `sync` can't upgrade the binary itself:** it's an npm-global install; a
self-replacing binary is fragile and often permission-blocked. Printing the exact
command and returning a distinct exit code is more reliable and an agent handles
it fine.

### Task 2.3 — The staleness nag

`cli/internal/client/client.go` already reads `X-BK-CLI-Latest` / `X-BK-CLI-Min`.
Extend the existing notice so the "update available" line names the fix:

```
bk 1.8.7 is behind 1.9.2 — run: bk skill sync
```

Print at most once per process, to **stderr** only, never on `--json` stdout.

### Task 2.4 — Landing page = the install funnel

The public landing page must let an agent bootstrap from zero with no prior
knowledge. Add a short, plainly-worded block (visible text, not just markup):

```
AI agents: this product is operated through a CLI.
  npm install -g @blackcode_sa/bc-issues
  bk login
  bk skill install
  bk guide
```

Mirror exactly this in `/llms.txt`. These two are now the **only** discovery
surfaces — everything else is reached through `bk`.

### Phase 2 verification

```bash
cd /tmp/fresh-project
bk skill install && cat .claude/skills/blackcode-issues/SKILL.md
bk skill check; echo "exit=$?"
bk skill sync;  echo "exit=$?"
```

---

## 7. Phase 3 — Demolition and the new guardrail

Do **not** start until Phase 0's content map shows every row landed.

### Task 3.1 — Delete the OpenAPI surface

- Delete `lib/openapi/spec.ts`.
- Delete `app/api/docs/` and `app/api/openapi.json/` **route bodies** — but see
  Task 4.2: they are replaced by a 410 Gone stub for one deprecation window, not
  removed outright.
- Delete `lib/openapi/parity.test.ts` (replaced below).

### Task 3.2 — Replace the parity guard with a CLI-coverage test

We keep the build-fails-on-drift protection; we just point it at the thing we now
care about: **every API route must be reachable from `bk`.**

1. Give every leaf cobra command an annotation naming the routes it calls:

   ```go
   Annotations: map[string]string{
       "routes": "GET /api/workspaces/{ws}/issues,POST /api/workspaces/{ws}/issues",
   },
   ```

2. Add a hidden `bk __routes` command that walks the command tree and prints the
   union as JSON.
3. Add a Go test asserting **every leaf command has a non-empty `routes`
   annotation** (this is what stops the annotation from silently rotting).
4. Replace `lib/openapi/parity.test.ts` with `lib/cli-parity.test.ts`: shell out
   to `go run ./cmd/bk __routes`, walk `app/api/**` exactly as the old test did,
   and assert:
   - every real route+method appears in the CLI's route set (**no uncovered
     route**), and
   - every route the CLI claims exists in code (**no drift**).
5. Carry forward the `EXCLUDED_PATHS` concept for genuine internals
   (`/api/auth/{nextauth}`, `/api/errors/client`, `/api/upload/blob`, and the
   Phase-4 deprecation stubs).

If `go` isn't available in CI for the JS test run, have the CLI build step emit
`cli/routes.json` as a build artifact and have the vitest read that instead.

### Task 3.3 — Slim the agent manifest

`lib/agent-manifest.ts` drops from 77 lines to roughly:

```ts
export const AGENT_MANIFEST = {
  project: 'blackcode issues',
  summary: 'AI-native issue tracker. Agents operate it through the bk CLI.',
  interface: 'CLI only. There is no supported HTTP API.',
  install: 'npm install -g @blackcode_sa/bc-issues',
  start: ['bk login', 'bk skill install', 'bk guide', 'bk meta'],
  package: '@blackcode_sa/bc-issues',
} as const
```

`AGENT_MANIFEST_NOTE` shrinks to the same 6 lines of prose.
`app/llms.txt/route.ts` keeps generating from this constant — it just gets short.

### Task 3.4 — Docs realignment

| File | Fate |
|---|---|
| `docs/platform-reference.md` | **Delete.** Its content is now the embedded guide — that's the baseline. |
| `docs/cli.md` | Keep, but re-scope to *maintainer* docs: build, release, version policy, package layout, internals. Agent-facing convention sections move to guide topics. |
| `docs/backend.md` | Keep as an internal doc. Add a header: *"Internal. The HTTP API is private plumbing — the only public contract is the `bk` CLI."* |
| `docs/frontend.md` | Unchanged. |
| `docs/api-changelog.md` | Keep. Now it has one job: the dated record + the input to migration messaging. |
| `docs/cli-sync.md` | Fold anything still true into `docs/cli.md`, then delete. |

`lib/changelog.ts` must stop reading `platform-reference.md`. `ChangelogPayload`
loses its `reference` field; `getChangelogMarkdown()` returns the log only.
Update `/changelog`, `GET /api/changelog`, `bk changelog`, and drop
`bk changelog --reference` (point it at `bk guide` with a hint line).

### Phase 3 verification

```bash
npx tsc --noEmit
npm test                     # includes the new lib/cli-parity.test.ts
cd cli && go build ./... && go test ./...
grep -ri "openapi" app lib docs cli --include='*.ts' --include='*.go' --include='*.md'
```

---

## 8. Phase 4 — Migrating the users who are already integrated

This is the part with real blast radius. Two populations:

- **A. Agents calling the HTTP API directly** (built from the OpenAPI spec or the
  page manifest).
- **B. Agents running an older `bk`** that has no `guide` / `skill` commands.

### The key fact that makes this safe

**We are not removing or changing any API route.** We are removing its
*documentation* and its *support promise*. So on deploy day, **every existing
integration keeps working.** There is no hard cutover, and no window where a
user's automation is broken with no path forward. Everything below is about
*informing* them, not *unblocking* them.

Design the whole migration around that: signal loudly, break nothing.

### Task 4.1 — Signal on every single API response

In `lib/api/handler.ts`, where `X-BK-CLI-*` headers are already set, add for a
90-day window:

```
X-BK-Migration: https://<host>/agent-updator
Warning: 299 - "The HTTP API is no longer a supported interface. Use the bk CLI: npm install -g @blackcode_sa/bc-issues && bk skill install"
Sunset: <RFC 1123 date, 90 days out>
```

Send `Sunset` + `Warning` **only to non-CLI callers**. The CLI identifies itself
via `User-Agent`/`X-BK-Client`; suppress the deprecation noise for it so `bk`
users don't see a warning that doesn't apply to them.

Headers are the right channel here: they reach every caller, and unlike adding a
field to the JSON body they cannot break anyone's response parsing.

### Task 4.2 — Turn the dead endpoints into signposts, not 404s

For the 90-day window, `GET /api/openapi.json` and `GET /api/docs` return
**`410 Gone`** with the standard error envelope:

```json
{
  "error": "The OpenAPI spec has been retired. blackcode issues is now operated through the bk CLI.",
  "code": "surface_retired",
  "suggestion": "npm install -g @blackcode_sa/bc-issues && bk login && bk skill install && bk guide"
}
```

A 410 with a `suggestion` is recoverable by an agent in the same run. A 404 is
not — it just looks like a bug. Add both paths to the parity test's exclusion set.
After the window, delete them.

### Task 4.3 — Rebuild `/agent-updator` as the migration page

`app/agent-updator/page.tsx` becomes the single canonical destination that every
signal points to. It must be readable by a human *and* scrapeable by an agent
(plain semantic HTML, no client-side-only rendering). Content:

1. **What changed**, in two sentences.
2. **What to do**, as four copy-pasteable commands.
3. **Nothing is broken yet** — with the sunset date stated explicitly.
4. **Where the old information went** — a short mapping table
   (`/api/openapi.json` → `bk guide`; page manifest → `bk guide`;
   `/api/meta` → `bk meta`; platform reference → `bk guide`).

### Task 4.4 — Bump the CLI minimum version (population B)

This is the strongest lever and it already exists. In `lib/cli-version.ts`:

```ts
export const CLI_LATEST_VERSION = process.env.BK_CLI_LATEST ?? '1.9.0'
export const CLI_MIN_VERSION    = process.env.BK_CLI_MIN    ?? '1.9.0'
```

Any `bk` older than 1.9.0 is hard-blocked with exit 8. **Before bumping, update
the block message** to name the new flow exactly:

```
This bk (1.8.7) is no longer supported. Update and refresh your agent skill:
  npm install -g @blackcode_sa/bc-issues@latest
  bk skill install
  bk guide
```

Order matters: **publish 1.9.0 to npm, verify it, then bump `CLI_MIN_VERSION`.**
Bumping first locks out every user with no working version to move to. Both
values are env-overridable, so keep the ability to roll back the floor without a
redeploy.

### Task 4.5 — Reach the humans

**REVISED 2026-08-03 — dropped.** This is an internal tool with a handful of
users, all reachable directly. The one-off migration email
(`scripts/send-cli-migration-email.ts`, `cliMigrationEmail`,
`sendCliMigrationEmail`) and the in-app banner (`components/cli-migration-banner.tsx`)
were built, then removed: broadcast machinery for an audience you can talk to is
maintenance with no reader. Tell them directly instead.

What remains as the written record:

- **Changelog entry**, dated, marked **breaking**, at the top of
  `docs/api-changelog.md`. This is the canonical record `bk changelog` serves.
- **README + landing page**, updated in the same deploy.
- **`/agent-updator`**, the page every migration signal points at.

### Task 4.6 — Deploy order

**REVISED 2026-08-03 — the timeline is collapsed.** Soak periods and a 90-day
sunset are for external integrators who need notice. There are none. Ship it all
at once:

```
1. Publish CLI 1.9.0 to npm. Verify a clean global install.   ← still first
2. Deploy the web app.
3. Run the §10 acceptance test against the deployed 1.9.0.
4. Set BK_CLI_MIN=1.9.0.
```

**Step 1 stays before step 4 — that ordering is a dependency, not caution.**
`CLI_MIN_VERSION` hard-blocks every older binary with exit 8. Raise it before
1.9.0 is installable and every user is locked out with nothing to upgrade *to*.
It is an env var, so it also rolls back instantly if step 3 finds a problem.

**There is no sunset.** The `Sunset` header is gone; the 410 stubs at
`/api/openapi.json` and `/api/docs` and the `Warning` / `X-BK-Migration` headers
stay indefinitely. Their audience is not a third-party integrator on a notice
period — it is an agent working from stale context that still has those URLs in
its prompt, and that agent can turn up at any time. A 410 with a `suggestion` is
recoverable in-run; a 404 just looks like a bug. They cost one file each.

This also removes the three-way date sync (`handler.ts` / `agent-updator` /
email script) that §13.4 flagged as needing to stay in step — one fewer set of
copies to keep aligned, which is the point of the whole project.

---

## 9. Phase 5 — Update the repo's own rules

Both files currently teach the seven-surface contract. Rewrite them, or the next
change will recreate what we just deleted.

**`CLAUDE.md`** — replace the "API multi-surface sync contract" section with:

> ### Agent surface contract (MANDATORY)
>
> Agents operate this product through **one** interface: the `bk` CLI. The HTTP
> API is private plumbing with no public contract — do not document it for
> external consumers, and never reintroduce an OpenAPI spec or a fat page
> manifest.
>
> When you add / change / remove a route or feature:
> 1. **Route** — `app/api/**`, same conventions as before.
> 2. **CLI** — add or update the `bk` command + client method, and its `routes`
>    annotation. `lib/cli-parity.test.ts` fails the build if a route has no CLI
>    coverage.
> 3. **Guide** — if agent-visible *behaviour* changed, update the relevant
>    `cli/internal/guide/topics/*.md`.
> 4. **`bk meta`** — if a vocabulary or limit changed, update its source
>    (`lib/work-items.ts` etc.); `/api/meta` and `bk meta` follow automatically.
> 5. **Deprecations** — if you renamed or removed a flag/command, add a row to
>    `cli/internal/commands/deprecations.go` in the same commit.
> 6. **Changelog** — one dated entry in `docs/api-changelog.md`.
>
> Before finishing: `npx tsc --noEmit`, `npm test`, `cd cli && go build ./... && go test ./...`

Delete the "Changelog rule" references to `docs/platform-reference.md`. Rewrite
`AGENTS.md` to match (it is the short version of the same contract).

---

## 10. Nothing-lost inventory

The mapping every chunk of today's documentation must land in. Phase 0 produces
the detailed version; this is the shape of it.

| Today | New home |
|---|---|
| OpenAPI route shapes | *Dropped by design* — the API is private. Capabilities live as `bk` commands. |
| OpenAPI descriptions / constraints / limits | `bk guide` topics + `bk meta.limits` |
| Manifest: `auth`, `get_a_token` | `guide/01-install-auth.md`, `bk login` |
| Manifest: `choosing_a_workspace` | `guide/02-workspaces.md` + `bk meta.workspaces` |
| Manifest: `list_envelope`, `error_envelope`, `pagination` | `guide/08-output-and-exit-codes.md` (restated as CLI output + exit codes, not HTTP envelopes) |
| Manifest: `rich_text` | `guide/04-rich-text.md` |
| Manifest: `file_uploads` (types, 100MB, inline preview vs. download card, embed syntax, `--file`) | `guide/05-files.md` + `bk meta.limits` / `bk meta.media` |
| Manifest: `storage` | `guide/06-storage.md` |
| Manifest: `move_items` | `guide/07-move-copy.md` |
| Manifest: `json_bodies` | *Dropped* — the CLI encodes bodies; the failure mode no longer exists |
| Manifest: `text_encoding` (UTF-8 / Windows `chcp`) | `guide/10-encoding.md` |
| Manifest: `staying_current`, `discovery` | `guide/12-staying-current.md` + `bk skill sync` |
| Platform reference §1–§6, §9, §10 | Guide topics (incl. `11-pitfalls.md` for §10 warnings) |
| Platform reference §7 (every endpoint) | *Dropped* — replaced by `bk guide --list` + `bk <group> --help` |
| Platform reference §8 (every command) | `bk --help` / `bk <group> --help` — already generated |
| Platform reference §11 (versioning) | `guide/12-staying-current.md` |
| `cli.md` agent conventions (nullable "none", user-refs, stdin `-`, `--*-file`, exit codes, scripting checklist) | Guide topics + per-command `--help` |
| `cli.md` build/release/internals | Stays in `docs/cli.md` (maintainer doc) |
| `root.go` "Conventions for agents" | Guide topics; `rootLong` keeps only the pointer |
| `docs/backend.md` | Stays, relabelled internal |
| `docs/api-changelog.md` | Stays |

**Acceptance test for "nothing lost":** take a fresh agent with no context, give
it only the landing page. It must be able to install, authenticate, pick the
right workspace, create a project with a description containing an uploaded
image, comment on it, move it to another workspace, and recover from a
deliberately wrong flag — using only `bk guide`, `bk meta`, and `--help`. If it
stalls, the missing knowledge is a gap in the guide. Run this before Phase 3.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Guide drifts from binary behaviour anyway | Topics are `//go:embed`-ed and versioned with the binary; CLAUDE.md step 3 makes updating them part of the change. Consider a Go test asserting every command group is named in at least one topic. |
| A route ends up with no CLI command | `lib/cli-parity.test.ts` fails the build. |
| `routes` annotations rot | Go test requires a non-empty annotation on every leaf command. |
| `CLI_MIN_VERSION` bumped too early, locking users out | Deploy order §8.6; both values env-overridable for instant rollback. |
| An existing HTTP integration breaks on deploy day | It can't — no route changes. Only docs and support promises are withdrawn. |
| Users never see the notice | Four channels: response headers, 410 stubs, email to token holders, in-app banner. |

---

## 12. Done checklist

- [ ] Phase 0 content map complete; every row has a landed destination
- [ ] `bk guide` works offline, unauthenticated, and covers all 13 topics
- [ ] `bk meta` carries limits, media rules and CLI versions — all derived
- [ ] `bk skill install` / `check` / `sync` work from a clean machine
- [ ] Deprecation table wired into usage errors; server `suggestion`s audited
- [ ] Landing page + `/llms.txt` bootstrap an agent from zero
- [ ] `lib/openapi/` deleted; `lib/cli-parity.test.ts` green
- [ ] `docs/platform-reference.md` + `docs/cli-sync.md` deleted; `lib/changelog.ts` updated
- [ ] Manifest ≤ 10 lines
- [ ] `/agent-updator` rebuilt; 410 stubs live; deprecation headers live
- [ ] Fresh-agent acceptance test passes
- [ ] CLI 1.9.0 on npm; `CLI_MIN_VERSION` bump scheduled (not immediate)
- [ ] Email + in-app banner sent
- [ ] Dated breaking changelog entry published
- [ ] `CLAUDE.md` + `AGENTS.md` rewritten to the new contract

---

# 13. Implementation notes (added 2026-08-03)

All six phases are implemented. Nothing is committed. Verification is green:

```
npx tsc --noEmit                               ✅
npm test                                       ✅  65 passed, 6 skipped (incl. lib/cli-parity.test.ts)
npm run build                                  ✅
cd cli && go build ./... && go vet ./...       ✅
cd cli && go test ./...                        ✅  commands, guide, skill
./bk guide / --list / <topic> / --json         ✅  offline, unauthenticated, 13 topics
./bk skill install / path / --format agents-md ✅  idempotent; re-run updates in place
```

## 13.1 What Phase 0 found (Task 0.2 — the reality check)

The content map is at `docs/_migration/content-map.md` (delete it once you're
satisfied). Its §0 lists nine reality-check findings. The four that mattered:

| # | The docs said | The code says |
|---|---|---|
| **R1** | Uploads accept **any file type** (manifest ×2, platform reference §6) | `app/api/upload/route.ts` rejects `image/svg+xml`. The OpenAPI spec was the *only* surface that got this right. |
| **R2** | `GET /api/upload` returns `{ blob, maxBytes }` (platform reference §7) | It returned `{ message, usage, maxSize: "100MB", blob, note }`. There was no `maxBytes`, and `maxSize` was a display string — nothing could act on the limit programmatically. **Fixed:** the route now returns a real `maxBytes`, and `bk meta.limits.upload_max_bytes` serves the same value. |
| **R3** | CLI latest/min = 1.8.6 (platform reference, twice) | `lib/cli-version.ts` said 1.8.7. The pinned baseline went stale the moment the CLI shipped — the clearest single argument for deleting it. |
| **R4** | *(silent)* | Workspace `name` is capped at **80 chars** and was documented on **no** surface — not the spec, not the reference. Now `bk meta.limits.workspace_name_max`. |

Each is fixed at the destination, not propagated.

## 13.2 Deviations from the plan (each deliberate)

**1. `lib/limits.ts` + `lib/agent-meta.ts` were added.** Task 1.2 says the new
`bk meta` fields must be *derived, never hand-typed*. The caps were inline
literals in eleven route handlers, so "derived" wasn't possible without a single
source. Limits are now declared once in `lib/limits.ts`, **imported by the route
that enforces them**, and assembled for `/api/meta` in `lib/agent-meta.ts`
(which also pulls the media rules from `lib/rich-text.ts` and the upload block
list from `lib/upload.ts`). `lib/limits.ts` is deliberately dependency-free so
any route can import it. Same treatment for the pagination defaults in
`lib/db/queries/{events,inbox,error-events}.ts`.

**2. Three small CLI commands were added, to make parity honest rather than
performed.** The guardrail is only worth having if its exclusion list is short
and every entry is defensible. Writing the annotations surfaced three routes
with no command, where "exclude it" would have been a lie:

- `bk label edit <id>` → `PATCH …/labels/{id}`. You could create and delete a
  label from the CLI but not rename or recolour it. In a CLI-only product that
  is a hole, not a convenience gap.
- `bk undo --log` → `GET /api/undo`. Preview what `bk undo` would roll back.
- `bk issue watch <id> --status` → `GET …/issues/{id}/watch`. The client method
  `GetWatchStatus` existed and **no command called it**.

**3. Four routes are excluded as operations, not paths** (in
`EXCLUDED_OPERATIONS`, each with a stated reason): `DELETE /api/me`,
`DELETE /api/workspaces/{ws}`, and the two `…/reorder` PATCHes. **See §13.3 —
the first two are a decision for you, not for me.**

**4. `bk changelog --reference` is deprecated, not deleted.** It prints a
`hint:` pointing at `bk guide` and continues. An agent that hits "unknown flag"
can only give up; one that gets a redirect can retry in the same run — the same
reasoning behind the 410 stubs. There is a matching row in
`cli/internal/commands/deprecations.go`.

**5. Exit code 9 is new** ("update available"), returned by `bk skill check` /
`bk skill sync` via `commands.UpdateAvailableError`. The plan specified exit 9
for `sync`; it needed a real error type to reach `main.go`, and `check` uses the
same one for consistency.

**6. `GET /api/changelog` returns `reference_moved_to` instead of dropping
`reference` silently.** A client built against the old shape gets a sentence
explaining where it went rather than `undefined`. Same for the CLI's `Changelog`
struct.

**7. The Go tests do more than the plan asked.** `guide_test.go` fails the build
if a topic hardcodes a dynamic value (`100MB`, `on_track`, `image/svg+xml`, …),
and `skill_test.go` fails if the template grows past 40 lines or mentions a
route, an enum or an auth header. The plan's §11 risk table wanted "a Go test
asserting every command group is named in at least one topic"; these are
stronger — they guard the *rule that makes the design work* rather than
coverage.

## 13.3 ⚠️ Two things I need you to decide

Both are in `lib/cli-parity.test.ts` → `EXCLUDED_OPERATIONS` with a reason
attached, so the build passes either way. But they are genuine capability gaps
covered by an exclusion, and that is your call, not mine:

1. **`DELETE /api/me`** — account deletion. Excluded as "irreversible and
   deliberately human-only". An agent cannot delete its owner's account, which
   is probably right. Confirm.
2. **`DELETE /api/workspaces/{ws}`** — workspace deletion (owner-only,
   irreversible). Excluded on the same grounds. This one is more arguable: an
   agent that can create a workspace arguably should be able to delete one it
   created. If you want it, `bk workspace delete <slug> --yes` is a ~40-line
   command and the exclusion comes out.

I did not invent destructive commands unasked. Say the word and I'll add either.

## 13.4 Before you deploy

**Deploy order (§8.6) is NOT done — it can't be from here.** What is ready:

- ✅ CLI 1.9.0 source; `cli/npm/package.json` bumped to `1.9.0`.
- ✅ `CLI_LATEST_VERSION = '1.9.0'`, **`CLI_MIN_VERSION` deliberately left at
  `'1.8.7'`** — per §8.6 step 2. Raise it to 1.9.0 via the `BK_CLI_MIN` env var
  **after** 1.9.0 is on npm and has soaked. No redeploy needed, and it rolls
  back the same way.
- ⬜ **Step 1: publish 1.9.0 to npm and verify a clean install.** Nothing else
  should ship before this.
- ⬜ Step 4: send the email. `npx tsx scripts/send-cli-migration-email.ts`
  defaults to **dry run** and prints the recipient list; `--send` delivers. It
  enumerates users with a non-expired token, one email per person. Note: the
  repo has no `tsx` dependency — add it, or run the script another way.

**The sunset date is 2026-11-01** (90 days). It appears in three places that must
stay in step: `lib/api/handler.ts` (`SUNSET_DATE`),
`app/agent-updator/page.tsx` (`SUNSET`), and
`scripts/send-cli-migration-email.ts` (`SUNSET`). The in-app banner has its own
30-day cutoff in `components/cli-migration-banner.tsx`.

**Deletion checklist for when the window closes** — grep for these:

- `app/api/openapi.json/route.ts` + `app/api/docs/route.ts` (the 410 stubs)
- `lib/api/retired.ts`
- the deprecation block in `lib/api/handler.ts` (`SUNSET_DATE`,
  `DEPRECATION_WARNING`, `isCliCaller`, and the three headers)
- the two `retired: 410 Gone deprecation stub` entries in
  `lib/cli-parity.test.ts` → `EXCLUDED_PATHS`
- `components/cli-migration-banner.tsx` + its render in
  `components/dashboard-layout.tsx`
- `docs/_migration/` (safe to delete as soon as you've read the content map)

**`cli/routes.json` is generated and committed.** `make routes` regenerates it.
The parity test prefers `go run ./cmd/bk __routes` and only falls back to the
artifact when Go is unavailable — so a stale artifact can't mask drift locally,
but regenerate it when annotations change.

## 13.5 Acceptance test (§10) — status

The fresh-agent scenario (install → auth → pick workspace → create a project with
an uploaded image in the description → comment → move to another workspace →
recover from a wrong flag) is **covered by the guide but not executed end-to-end**
— it needs a live server and a real npm install, which I can't do from here.
Every step has a topic: `01-install-auth`, `02-workspaces`, `05-files` (the
`--file` one-step embed and the angle-bracket rule), `07-move-copy` (including
reading `adjustments`), `08-output-and-exit-codes`, and `11-pitfalls` (the
wrong-flag recovery). **Run it against the deployed 1.9.0 before step 5 of the
deploy order** — a stall there is a gap in the guide, and the guide is now the
only place to fix it.

## 13.6 Files added / deleted

**Added:** `lib/limits.ts`, `lib/agent-meta.ts`, `lib/api/retired.ts`,
`lib/cli-parity.test.ts`, `components/cli-migration-banner.tsx`,
`scripts/send-cli-migration-email.ts`, `docs/_migration/content-map.md`,
`cli/internal/guide/` (guide.go + 13 topics + guide_test.go),
`cli/internal/skill/` (skill.go + template.md + skill_test.go),
`cli/internal/commands/{guide,skill,routes,deprecations}.go`,
`cli/internal/commands/routes_test.go`, `cli/routes.json`.

**Deleted:** `lib/openapi/` (spec.ts, parity.test.ts),
`docs/platform-reference.md`, `docs/cli-sync.md`.

---

## 14. Follow-up round (2026-08-03, after review)

Three changes on top of the implementation above.

### 14.1 `bk workspace delete` added — §13.3 decision 2 resolved

`DELETE /api/workspaces/{ws}` is out of `EXCLUDED_OPERATIONS` and covered by a
real command. An agent that can create a workspace could not clean one up, and
the workaround — leave debris, or ask a human to go click in the web UI — is
worse than the risk.

Guarded harder than the usual destructive command, because the usual guard does
not hold for agents: `Confirm()` auto-approves under `BK_NO_PROMPT=1` and on a
non-TTY, which is exactly how agents run. So `--yes` is not a guard at all there.
The real one is `--confirm`, which must repeat the target back and is required
unconditionally. Plus `cobra.ExactArgs(1)` — it never falls back to the active
workspace, because "delete whatever I'm pointed at" is not a safe default for an
irreversible call. On success, a deleted active workspace is cleared from config
so the next command fails clearly instead of 404-ing.

**§13.3 decision 1 stands: `DELETE /api/me` remains excluded.** An agent should
never be able to delete its owner's account.

### 14.2 Email + in-app banner removed

See the revised §8 Task 4.5. Deleted: `scripts/send-cli-migration-email.ts`,
`components/cli-migration-banner.tsx`, `cliMigrationEmail` +
`CliMigrationEmailInput` in `lib/email/templates.ts`, `sendCliMigrationEmail` in
`lib/email/send.ts`, and the banner's import + render in
`components/dashboard-layout.tsx`.

This also closes the `tsx`-dependency gap from §13.4 — the script that needed it
is gone.

### 14.3 The sunset window removed

See the revised §8 Task 4.6. The `Sunset` header and the `SUNSET_DATE` /
`SUNSET` constants are gone from `lib/api/handler.ts` and
`app/agent-updator/page.tsx`. The 410 stubs and the `Warning` /
`X-BK-Migration` headers are now permanent.

**The §13.4 deletion checklist is therefore void** — there is no window to close.
The only thing still safe to delete is `docs/_migration/`, once the content map
has been read.

### 14.4 Three CLI error-reporting defects fixed (pre-existing)

Found while testing 14.1. All three predate this project and all three undercut
the thing the design depends on — an agent branching on exit codes and reading
`hint:` lines.

1. **A mistyped subcommand exited `0`.** Cobra prints help and returns `nil` for
   any command group, so `bk workspace notacmd` reported success. It also made
   `DeprecationHint` unreachable for a renamed *subcommand*: the "unknown
   command" failure `hintFor()` keys off never occurred. Fixed by
   `rejectUnknownSubcommands()` in `root.go`, which walks the tree at
   construction. `Args: cobra.NoArgs` does **not** work here — cobra returns
   `flag.ErrHelp` for a non-runnable command before it validates args.
2. **Argument-count errors returned `1`,** though the documented table promises
   `2` for cobra arg/flag errors. Fixed in `classify()` in `main.go`.
3. **Every error printed twice,** once by cobra and once by `main.go`, on the
   stderr agents parse. Fixed with `SilenceErrors: true`.

`cli/internal/commands/groups_test.go` locks 1 in for every group, present and
future, and asserts the converse — a bare `bk <group>` still prints help and
exits 0.

Also filled a gap this surfaced: the guide's exit-code table stopped at 8 and
never documented the new code 9.
