# Platform Migration Plan

**Goal:** turn today's single-app `bc-issues` repo into `blackcode-platform` —
a monorepo where **adding a new app is a checklist, not a project**.

**Non-goal:** building sales, CRM or bookkeeping. No new app is created here. We
finish when `apps/issues` runs exactly as it does today on top of a platform
that a second app can be dropped onto.

Companion doc: **`PLATFORM-ARCHITECTURE.md`** — the *what* and *why*. This file
is the *how* and *in what order*.

---

## Ground rules for every phase

1. **Never break bc-issues.** It is in daily use. Every phase ends deployable.
2. **One phase, one PR, one merge.** Never two phases in flight.
3. **Green means green** — all four, run **from the repo root**:
   ```bash
   npm run typecheck    # NOT `npx tsc --noEmit` — see below
   npm test
   npm run build
   cd cli && go build ./... && go vet ./... && go test ./...
   ```
   Plus `cd cli && make routes` whenever a `routes` annotation changed.

   > Changed in Phase 1: there is deliberately no root `tsconfig.json`, because a
   > root config that compiles nothing reports a **vacuous green** — worse than a
   > loud failure. `npm run typecheck` fans out through Turborepo to every
   > workspace. Use it everywhere the old command appeared.
4. **Changelog discipline holds throughout.** Every agent-visible change gets a
   dated entry in the same commit. Internal refactors (Phases 1, 2) are *not*
   agent-visible and get no entry.
5. **Every DB migration is rehearsed on a Neon branch first**, then applied to
   `main`. No exceptions, no "it's only a rename".
6. **Every phase has a rollback.** Written down before starting, not after.

---

## Phase overview

| # | Phase | Agent-visible? | DB migration | CLI release |
|---|---|---|---|---|
| 0 | Pre-flight & baseline | no | no | yes (safety pin) |
| 1 | Monorepo skeleton | no | no | no |
| 2 | Extract `packages/platform-*` | no | no | no |
| 3 | Postgres schemas + roles | no | **yes** | no |
| 4 | App registry, access & identity | yes | **yes** | yes |
| 5 | Agent-surface separation | **yes (breaking-ish)** | no | **yes, minor** |
| 6 | Cross-app primitives | yes | **yes** | yes |
| 7 | Storage & blob attribution | no | **yes** | no |
| 8 | Harden + "add an app" kit | no | no | yes |

Phases 3 and 5 are the two with real risk. Everything else is mechanical.

---

## Phase 0 — Pre-flight & baseline

**Why first:** you cannot tell whether a refactor broke something without a
known-good baseline and a way back.

### Steps

1. **Tag the pre-migration state.** `git tag pre-platform-migration` and push it.
2. **Capture a full baseline.** Record the current output of all four verify
   commands into `docs/migration/baseline.md`: test counts, route count from the
   CLI-parity test, `bk --help` command list, `bk guide` topic slugs.
3. **Take a Neon backup / snapshot** of `main`, and confirm you know how to
   restore it. Note the retention window.
4. **Release the current CLI** (`./devops/release.sh cli patch`) so there is a
   published binary matching pre-migration behaviour. Do **not** raise
   `CLI_MIN_VERSION`.
5. **Write down the current env var inventory** — every var in the Vercel
   project, which are Neon-provided, which are Blob-provided. This becomes
   `docs/env.md`'s platform/app split later.
6. **Rename the GitHub repo `bc-issues` → `blackcode-platform`.** Decided:
   rename, do not create a fresh repo. Renaming keeps issue/PR history, keeps
   every existing clone working (GitHub redirects the old URL), and keeps the
   npm package's repository link valid.

   After renaming, check and update:
   - local remotes — `git remote set-url origin …` on every machine
   - the Vercel project's connected Git repository
   - `repository.url` in `cli/npm/package.json` and any root `package.json`
   - any GitHub Actions, deploy hooks or webhooks referencing the old name
   - links in `README.md`, `docs/*`, and the `bk` guide topics

   The **npm package name stays `@blackcode_sa/bc-issues`** for now — renaming a
   published package is a separate, breaking decision for agents that have it
   installed. Revisit at Phase 8, not here.

### Done when

- The tag exists, the snapshot exists, the baseline file exists.
- A published CLI version matches pre-migration behaviour.

### Rollback

N/A — nothing changed yet.

---

## Phase 1 — Monorepo skeleton

**Goal:** the exact same app, one directory deeper, building through Turborepo.
Zero behaviour change. Not one line of application logic edited.

### Steps

1. **Create the workspace root.**
   - Root `package.json`: `"private": true`, `"workspaces": ["apps/*", "packages/*"]`, and **no** app dependencies.
   - Add `turbo.json` with `build`, `dev`, `lint`, `test`, `typecheck` pipelines.
   - Add `tsconfig.base.json`; apps extend it.
2. **Move the app.** `git mv` into `apps/issues/`:
   `app/ components/ lib/ types/ public/ middleware.ts next.config.js postcss.config.js tsconfig.json drizzle.config.ts vercel.json vitest.config.ts components.json package.json`
   Use `git mv` so history follows the files.
3. **Leave at root:** `cli/`, `docs/`, `devops/`, `scripts/`, `docker-compose.yml`,
   `CLAUDE.md`, `AGENTS.md`, `README.md`, the two platform docs.
4. **Fix pathing.** `apps/issues/tsconfig.json` extends the base; check every
   `@/` alias still resolves; check `drizzle.config.ts` migration paths.
5. **Rewire scripts.** Root `npm run dev` → `turbo run dev --filter=issues`.
   Keep the old script names working so muscle memory survives.
6. **Repoint Vercel.** In the bc-issues Vercel project set **Root Directory** to
   `apps/issues`. Set the ignored-build step to `npx turbo-ignore`.
7. **Update `CLAUDE.md` + `AGENTS.md` paths** — every `lib/…` reference becomes
   `apps/issues/lib/…`. This matters more than it looks: these files steer every
   agent that touches the repo.

### Verify

- All four commands green **from the repo root**.
- `npm run build` succeeds.
- Deploy a Vercel **preview** and click through: login, workspace switch, create
  an issue, upload a file, comment. Do not promote yet.
- `git log --follow apps/issues/lib/db/schema.ts` shows full history.

### Done when

Preview deploy is functionally identical to production. Then promote.

### Rollback

`git revert` the merge. Reset the Vercel Root Directory. Nothing else moved.

---

## Phase 2 — Extract `packages/platform-*`

**Goal:** the platform/app seam becomes real code with real import boundaries.
Still zero behaviour change.

### Package split

| Package | Takes from `apps/issues/` |
|---|---|
| `@blackcode/platform-db` | `lib/db/client.ts`, the platform half of `lib/db/schema.ts`, shared query helpers |
| `@blackcode/platform-auth` | `lib/auth.ts`, `lib/auth/*`, session + token verification, whitelist, super-admin guard |
| `@blackcode/platform-api` | `lib/api/*` (`handler`, `errors`, `responses`, `workspace-context`, `serialize`, `sanitize`), `lib/limits.ts` |
| `@blackcode/platform-ui` | `components/ui/*`, `rich-text-editor.tsx`, theme + tokens, `app/globals.css` |
| `@blackcode/platform-agent` | `lib/agent-meta.ts`, `lib/changelog.ts`, `lib/cli-version.ts`, `llms.txt` renderer, `/agent-updator` content, the CLI-parity harness |
| `@blackcode/platform-storage` | `lib/upload.ts`, `lib/blob-refs.ts`, `lib/blob-gc.ts`, `lib/file-attachment.ts` |

**Stays in `apps/issues/`:** `lib/work-items.ts`, `lib/db/queries/*`,
`lib/rich-text.ts` *(shared later if a second app needs it — do not
pre-generalise)*, all routes, all pages, all issue-specific components.

### Steps

1. Create packages one at a time, **in dependency order**:
   `platform-db` → `platform-api` → `platform-auth` → `platform-storage` →
   `platform-agent` → `platform-ui`. Merge and verify green after each.
2. Each package: `package.json` (name, `main`, `types`), `tsconfig.json`
   extending the base, no build step (transpiled by Next via
   `transpilePackages`).
3. `apps/issues/next.config.js` gets `transpilePackages: ['@blackcode/platform-*']`.
4. Replace imports with the package name. `@/lib/api` → `@blackcode/platform-api`.
5. **Add the import-boundary lint** now, while there is one app to violate it:
   an ESLint `no-restricted-imports` rule blocking `apps/*/…` imports from
   anywhere outside that app.

### Judgement rule for what gets extracted

> Move it only if a **sales app would need it unchanged**. If you'd have to add a
> parameter to make it generic, leave it in `apps/issues` and extract it when the
> second app actually asks. Speculative generalisation is how platforms rot.

### Verify

Four commands green after **each** package. Preview deploy after the last one.

### Rollback

Per-package revert. Each merge is independently reversible.

---

## Phase 3 — Postgres schemas + per-app roles

**Goal:** `platform.*` and `issues.*` become real namespaces with database-level
grants. The highest-risk phase — every query in the app changes namespace.

**Do this before a second app exists.** It is a rename now and a coordinated
multi-app migration later.

### Steps

0. **Resolve the drizzle-kit snapshot drift first.** `drizzle-kit generate`
   currently cannot run non-interactively — it stops on a rename/conflict
   prompt, meaning `schema.ts` has drifted from the last snapshot. `drizzle-kit
   check` passes, so the migration files are self-consistent; the drift is
   code-vs-snapshot. Found in Phase 2 and deliberately deferred to here, because
   this is the first phase that generates a migration. Fix it before writing any
   other Phase 3 code — a rename prompt during a schema move is how the wrong
   migration gets generated.
1. **Rehearse on a Neon branch.** Create `migration-rehearsal` from `main`, run
   everything below against it, point a local dev server at it, exercise the app.
2. **Create schemas and move tables.**
   ```sql
   CREATE SCHEMA platform;
   CREATE SCHEMA issues;
   ALTER TABLE users SET SCHEMA platform;      -- ×16 platform tables
   ALTER TABLE issues SET SCHEMA issues;       -- ×10 app tables
   ```
   `ALTER TABLE … SET SCHEMA` moves the table with its data, indexes,
   constraints and FKs intact. Cross-schema FKs stay valid — an `issues.issues`
   row can still reference `platform.workspaces`.
   The full table lists are in `PLATFORM-ARCHITECTURE.md` §4.3.
3. **Update Drizzle.** `pgSchema('platform')` in `platform-db`,
   `pgSchema('issues')` in `apps/issues`. Every `pgTable` becomes
   `platformSchema.table(...)` / `issuesSchema.table(...)`.
4. **Create the roles and grants.**
   ```sql
   CREATE ROLE issues_app LOGIN PASSWORD '…';
   GRANT USAGE ON SCHEMA platform, issues TO issues_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform, issues TO issues_app;
   ALTER DEFAULT PRIVILEGES IN SCHEMA platform, issues GRANT … TO issues_app;
   ```
   Plus a `migrator` role that owns the schemas and runs migrations. The app role
   must **not** own tables — that is what stops an app silently altering the
   platform schema.
5. **Qualify every table reference. There is no `search_path` safety net — it
   does not work here.** (Corrected 2026-08-04, after the Phase 3 rehearsal
   proved the original instruction wrong.)

   Neon's pooled endpoint — which production and preview both use — defeats all
   three ways of setting it:

   | Approach | Result |
   |---|---|
   | `ALTER ROLE … SET search_path` | **ignored** — pooled session still reports `"$user", public` |
   | `options=-c search_path=…` in the URL | **rejected** — "unsupported startup parameter… use unpooled connection" |
   | `SET search_path` per connection | works, but it is session state under PgBouncer *transaction* pooling, so it can leak to another client |

   Drizzle's `pgSchema` qualifies ORM calls automatically but does **not** touch
   raw ``sql` ` `` queries — ~118 references across ~17 files. Qualify them by
   **interpolating the Drizzle table object**, never by hardcoding a string:

   ```ts
   // wrong — unqualified, resolves to nothing after the split
   sql`SELECT count(*) FROM issue_labels il JOIN issues i ON i.id = il.issue_id`

   // wrong — qualified, but a typo is invisible until it runs in production
   sql`SELECT count(*) FROM issues.issue_labels il JOIN issues.issues i ON …`

   // right — type-checked, and it follows the table if it ever moves schema
   sql`SELECT count(*) FROM ${issueLabels} il JOIN ${issues} i ON i.id = il.issue_id`
   ```

   The third form is the standard. A mistyped identifier fails `npm run
   typecheck`, and Phases 6 and 7 move more tables without revisiting these call
   sites. Most affected files already import the table objects they name in raw
   SQL — `labels.ts` imports `issueLabels, issues, labels` and then names all
   three as bare strings — so this is usually a substitution, not a new import.
6. **Swap `DATABASE_URL`** in Vercel to the `issues_app` role's connection
   string. Keep the old one recorded for rollback.
7. **Document the role-creation SQL** in `docs/platform-db.md` — it becomes step
   1 of the "add an app" checklist.

### Verify

- Rehearsal branch: full manual pass of the app.
- `npm test` green; the parity test unaffected (routes didn't change).
- Confirm the boundary works: connect as `issues_app` and check you *can* read
  `platform.workspaces`. Then create a throwaway `probe_app` role with no
  `issues` grant and confirm `SELECT FROM issues.issues` is denied.
- Deploy preview against the rehearsal branch before touching `main`.

### Rollback

`ALTER TABLE … SET SCHEMA public` in reverse, revert the Drizzle commit, restore
the old `DATABASE_URL`. Rehearse the rollback on the branch too — a rollback you
haven't run is a hope, not a plan.

---

## Phase 4 — App registry, access & identity

**Goal:** the platform learns that apps exist, and who may use which. Nothing is
visible to users yet except one new settings screen.

### Schema

```sql
platform.apps           (slug PK, name, description, base_url, enabled)
platform.workspace_apps (workspace_id, app, enabled_at, enabled_by,
                         default_access)   -- 'all_members' | 'invite_only'
platform.app_access     (workspace_id, app, user_id, role, granted_at, granted_by)
```

Plus `workspace_invitations.app` (nullable — NULL means org-level invite).

### Backfill (critical — this is where users get locked out if sloppy)

```sql
INSERT INTO platform.apps VALUES ('issues', 'Blackcode Issues', …);
-- every existing workspace gets issues enabled, default-on
INSERT INTO platform.workspace_apps
  SELECT id, 'issues', now(), NULL, 'all_members' FROM platform.workspaces;
-- every existing member gets access, mirroring their workspace role
INSERT INTO platform.app_access
  SELECT workspace_id, 'issues', user_id, role, now(), NULL
  FROM platform.workspace_members;
```

Verify the row counts match `workspace_members` **before** enforcing anything.

### Steps

1. Migration + backfill, rehearsed on a branch.
2. `platform-auth` gains `requireAppAccess(app, workspaceId, userId)`.
3. Wire it into `apps/issues`' workspace-context resolver and **enforce from day
   one**, behind an env kill switch (`PLATFORM_ENFORCE_APP_ACCESS`).

   At ~10 users we can *prove* the backfill is complete instead of watching for
   it. Before flipping enforcement on, this query must return zero rows:

   ```sql
   SELECT m.workspace_id, m.user_id
   FROM platform.workspace_members m
   LEFT JOIN platform.app_access a
     ON a.workspace_id = m.workspace_id
    AND a.user_id      = m.user_id
    AND a.app          = 'issues'
   WHERE a.user_id IS NULL;
   ```

   Exhaustive verification beats a soak period when the population is small
   enough to enumerate.

   **But a query only proves the backfill — not the code.** The real risk is a
   path that creates membership *without* creating `app_access`, which no
   historical check can catch.

   **Corrected 2026-08-04** — an earlier draft of this step named four paths
   including "super-admin tools". That was wrong: no route under
   `app/api/super-admin/` inserts membership. The real surface is **two live
   INSERT sites serving four entry points**:

   | INSERT site | Entry points it serves |
   |---|---|
   | `invitations.ts:304` | accepting an invitation |
   | `workspaces.ts:146` (`createWorkspace`) | explicit workspace create; `POST /api/auth/register`; OAuth first login via `lib/auth.ts:67` → `ensureDefaultWorkspace` |

   Both must write the `app_access` row (or an explicit `invite_only` denial) in
   the **same transaction** as the membership row, and both need a test.

   **Delete `addMember` (`workspaces.ts:395-403`) first.** It is a third
   membership INSERT with no callers — `invitations.ts` imports it solely to
   re-export it, with a comment admitting the import is unused. Wired up after
   enforcement lands, it would create membership with no `app_access` row and
   lock out the next person. A dead function that can silently deny access is
   worse than no function.

   Keep the kill switch for one release, and make every denial log loudly with
   the user, workspace and app. If something slips through, it is one env var to
   unblock everyone.
4. **Grant policy:** `default_access = 'all_members'` means joining a workspace
   auto-inserts `app_access` for every enabled app. `invite_only` means access is
   granted explicitly. Implement both; default every workspace to `all_members`.
5. **Workspace-level cascade:** deleting a workspace removes its `workspace_apps`
   and `app_access` rows; removing a member removes their `app_access`.
6. **UI:** a workspace-settings "Apps" tab listing available apps, an
   enable/disable toggle, the `default_access` selector, and a per-member access
   list. One screen — do not gold-plate it.
7. **Session cookie → `.blackcode.ch`.** Set the next-auth cookie domain so one
   login covers every future subdomain. Test that existing sessions survive or
   fail cleanly to the login page (this can log everyone out once — do it at a
   quiet hour and say so in the changelog).
8. **`bk meta` reports `apps`** — only those the token can reach.
9. **`bk workspace list`** filters to the current app; `--all` shows every
   workspace with per-app badges.

### Verify

- The orphaned-member query above returns **zero rows**.
- Tests cover all four membership-creating paths (invitation accept, workspace
  create, super-admin tools, OAuth first login).
- New user invited to a workspace lands with issues access automatically.
- A workspace flipped to `invite_only` denies a new member until granted, and
  the denial has a `suggestion` telling them what to do.

### Rollback

Enforcement is behind a flag — flip it off. The tables can stay; they're inert.

---

## Phase 5 — Agent-surface separation

**Goal:** the CLI, guide, changelog, meta and docs all separate by app while
there is only one app to separate. **The only phase with user-visible breakage**,
which is exactly why it happens now rather than with three apps live.

### 5.0 Carried over from Phase 4 — do these first

Four CLI defects found while verifying Phase 4 and deliberately not fixed there
(out of scope). The first two are **live agent-facing failures today**, not
cosmetics, and this is the phase that already opens every one of these files.

1. **`bk invite accept <token>` fails when the token starts with `-`.** Cobra
   reads it as a flag: `unknown shorthand flag: 'J'`. Invitation tokens are
   base64url, so roughly **1 in 32** starts with `-` or `_` and simply cannot be
   accepted — hit for real during Phase 4 verification. Fix **both ends**: make
   the command tolerate a leading `-` (so already-installed binaries recover),
   *and* stop generating such tokens in `generateInvitationToken`
   (`lib/db/queries/invitations.ts`), so old binaries stop meeting the case at
   all. Fixing only the CLI leaves every deployed version broken.
2. **`client.UpdateWorkspaceMemberRole` calls `PATCH /api/workspaces/{ws}/members/{userId}`,
   a route that only exports `DELETE`.** A broken client method. **The gap matters
   more than the bug:** the parity test can only see routes a command *annotates*,
   so a client method reachable from no command is invisible to it. Note that
   limitation next to the fix — it is the second time a guardrail has been found
   to have a blind spot, and the blind spot is the reusable finding.
3. **Every `suggestion` prints twice** — once inside `client.APIError.Error()`
   and again as `hintFor()`'s `hint:` line. Exactly the double-print that
   `SilenceErrors` was added to `root.go` to stop, on the channel agents parse.
   Phase 4 made it a common path (`app_access_denied` is expected traffic now).
4. **`cli-parity.test.ts:218` uses a relative `walk('app/api')`** while the rest
   of the file resolves from `APP_ROOT` — it passes only because vitest's cwd is
   the app directory, which is the cwd dependence that file's own comment claims
   to have removed.

### 5.1 CLI namespacing

- Move `cli/internal/commands/` into `commands/platform/` and `commands/issues/`.
- New shape: `bk issues issue create`, `bk issues task list`, `bk issues project …`.
- Platform verbs stay bare: `login`, `meta`, `guide`, `changelog`, `workspace`,
  `token`, `storage`, `undo`, `trash`, `inbox`, `member`, `invite`, `profile`,
  `user`, `superadmin`.
- **Every old spelling becomes a working deprecated alias.** `bk issue create`
  runs, succeeds, and prints one stderr line: `deprecated: use 'bk issues issue
  create'`. Add a row per alias to `cli/internal/commands/deprecations.go`.
  Keep for two minor releases, then prune.
- `bk --help` lists platform verbs, then one line per app.

### 5.2 Guide split

- `cli/internal/guide/topics/platform/` — install & auth, workspaces, output &
  exit codes, encoding, files, storage, undo & trash, staying current.
- `cli/internal/guide/topics/issues/` — items, move/copy, issue pitfalls.
- `guide.go` walks both levels; slugs become `platform/workspaces`,
  `issues/items`.
- `bk guide` prints platform first, then each app under a heading.
  `bk guide --app issues` scopes.
- **Extend `guide_test.go`:** a topic under `topics/<app>/` may not name another
  app; the existing no-dynamic-values check now runs per directory.

### 5.3 Changelog split

- `docs/api-changelog.md` → `docs/changelog/platform.md` + `docs/changelog/issues.md`.
- **Do not rewrite history.** Move existing entries wholesale into
  `issues.md`, and put a dated note at the top of both explaining the split and
  where the pre-split log lives.
- `lib/changelog.ts` (now in `platform-agent`) merges files by date into one
  feed, tagging each entry with its app.
- `bk changelog` = merged; `bk changelog --app issues` = filtered.

### 5.4 `bk meta` grouping

Response becomes `{ user, workspaces, cli, apps: { issues: { statuses, priorities, limits, … } } }`.
Never flatten two apps' vocabularies into one top-level list.

**This is a breaking response shape.** Ship it with the CLI release that reads
it, keep the old top-level keys for two minor releases alongside the new
`apps.issues` block, and say so loudly in the changelog.

### 5.5 Docs split

- `/docs` — platform only: this plan, the architecture doc, `platform-db.md`,
  `platform-api.md`, `cli.md`, `devops.md`, `env.md`, `changelog/`.
- `/apps/issues/docs` — `backend.md`, `frontend.md` (issue-tracker halves),
  domain model, UI patterns.
- Split today's `backend.md`/`frontend.md` along the platform/app line.
- Update the Docs sync rule in `CLAUDE.md` to name both locations.

### 5.6 Release

This is a **minor** CLI release with a changelog entry covering all five changes
and the migration for each. Publish to npm **before** touching `CLI_MIN_VERSION`
— and do not raise the floor in this release at all. Raise it one release later,
once you can see adoption.

### Verify

- `go test ./...` including the extended guide test and a new namespace test.
- Every deprecated alias resolves to the right command (table-driven test).
- `bk skill sync` produces a skill describing the new command shape.
- Install the published binary fresh and run an end-to-end agent flow.

### Rollback

CLI: users pin the previous version (the floor was not raised — this is why).
Server: the `apps` block is additive; old keys still present.

---

## Phase 6 — Cross-app primitives

**Goal:** build the machinery that makes two apps worth having, and prove it
against one app so it is real code, not a design.

### Schema

```sql
platform.entities (urn PK, app, workspace_id, entity_type, number,
                   title, url, updated_at, deleted_at)
platform.links    (from_urn, to_urn, rel, created_by, created_at)
platform.events   -- generalise today's per-workspace events: + app, + subject_urn
```

URN format: `bc:<app>:<workspace-slug>/<entity-type>/<number>` — using the
workspace #number, never the global db id.

### Steps

1. Migration + backfill: write an `entities` row for every existing issue, task
   and project.
2. `platform-db` exposes URN parse/format and an `upsertEntity` helper.
3. `apps/issues` writes to `entities` on every create/update/delete of an issue,
   task or project. Keep it in the same transaction as the write itself — a
   projection that can drift is worse than no projection.
4. Generalise `events` with `app` and `subject_urn`; backfill existing rows with
   `app = 'issues'`.
5. New commands: `bk link create|list|rm`, `bk activity --ws <slug> --since`,
   `bk search <query>` — all reading `platform.*`, all app-agnostic.
6. Guide topic `platform/cross-app.md` explaining URNs and links to agents.
7. Add a **reconciliation job** that re-derives `entities` from source tables and
   reports drift. Run it weekly. Build it now, while there is one writer.

### Verify

- `bk search` finds issues by title; `bk activity` shows a coherent timeline.
- A link survives a rename of the target.
- Reconciliation reports zero drift after a day of normal use.

### Rollback

Purely additive. Stop writing, drop the tables.

---

## Phase 7 — Storage & blob attribution

**Goal:** one Blob store that stays sortable and extractable as apps are added.

### Steps

1. New uploads write under an app prefix: `issues/<workspace>/<file>`.
2. `platform.uploads` gains an `app` column; backfill existing rows to
   `'issues'`. Do **not** move existing blobs — the ledger records where each one
   actually lives.
3. Make reference-counting app-aware: a blob is deletable only when **no app**
   references it. Today's scan covers issue/task/project bodies; the interface
   becomes "each app registers a reference scanner", and issues registers the
   current one.
4. `bk storage list` gains an app column and an `--app` filter.

### Verify

- Upload → embed → delete → GC still frees the file.
- A blob referenced from two apps (simulate with a second scanner in a test) is
  refused deletion.

### Rollback

Additive column plus a prefix change on new writes only. Revert the code.

---

## Phase 8 — Harden + the "add an app" kit

**Goal:** make the next app cheap and hard to get wrong. This is the phase that
decides whether any of the previous seven were worth it.

### Steps

0. **Write `docs/platform-db.md`.** Phase 3 step 7 says to document the
   role-creation SQL there and it was never created — the SQL lives in
   `docs/sql/app-role.sql` instead. The checklist below references it as step 2,
   so this is the phase that makes that reference true rather than a dangling
   pointer.
1. **`docs/adding-an-app.md`** — the ordered checklist:
   1. `packages/` deps and `apps/<name>/` from the template
   2. `CREATE SCHEMA <app>` + role + grants (SQL in `docs/platform-db.md`)
   3. row in `platform.apps`
   4. `cli/internal/commands/<app>/` + `routes` annotations
   5. `cli/internal/guide/topics/<app>/`
   6. `docs/changelog/<app>.md`
   7. Vercel project → existing Neon + Blob, Root Directory, `turbo-ignore`
   8. subdomain + cookie domain check
   9. `apps/<name>/docs/`
2. **`apps/_template/`** — a minimal working app: one entity, one route, one CLI
   command group, one guide topic, one page. It must build and pass the parity
   test on day one. A template that doesn't run is a lie.
3. **Guardrails complete and enforced in CI:**
   - CLI-parity test runs per app
   - guide test: no dynamic values, no cross-app references
   - ESLint: no `apps/<a>` → `apps/<b>` imports
   - a schema test asserting no app queries another app's schema
4. **Extraction rehearsal.** Actually run it once: `pg_dump --schema=issues`,
   stand it up beside a vendored copy of the platform packages, confirm it
   boots. Time it, write down what hurt. This validates the "we could sell one"
   claim while it's cheap to fix.
5. **Rewrite `CLAUDE.md` and `AGENTS.md`** for the monorepo: paths, the per-app
   contract, the three entry points, where each kind of doc lives.
6. **Final CLI release** and, one release later, raise `CLI_MIN_VERSION` to the
   first namespaced version.

### Done when

Someone who has never seen the repo can follow `docs/adding-an-app.md` and get a
second app deployed without asking a question.

---

## Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| Schema move corrupts data | 3 | Neon branch rehearsal + snapshot + rehearsed rollback |
| Access backfill locks users out | 4 | Orphaned-member query returns zero + tests on all membership-creating paths + env kill switch |
| Cookie-domain change logs everyone out | 4 | Quiet hour, changelog notice, verified re-login path |
| Agents break on the new CLI shape | 5 | Deprecated aliases for two minors; floor **not** raised in the same release |
| `bk meta` shape breaks integrations | 5 | Old keys kept alongside `apps.*` for two minors |
| `entities` projection drifts | 6 | Same-transaction writes + weekly reconciliation job |
| Over-extraction into packages | 2 | The "would sales need it unchanged?" rule; extract on demand |
| Migration stalls half-done | all | One phase per PR, each independently deployable and revertible |

## Sequencing constraints

- **2 before 3** — `platform-db` must own the platform schema before tables move.
- **3 before 4** — access tables belong in the `platform` schema from birth.
- **3 before 6** — cross-app tables belong in `platform` too.
- **4 before 5** — `bk meta` can't report `apps` before apps exist as data.
- **5 before 8** — the template must reflect the final command and doc shape.
- **Phase 7 can move** anywhere after 3 if it's convenient.

## The production cutover pattern (use this for Phases 4, 6 and 7)

Proven in Phase 3 on 2026-08-04. `RUN_MIGRATIONS=1` makes the production build
run `drizzle-kit migrate`, so a plain `vercel --prod` migrates the database
*mid-build* while the old code is still serving — broken for the rest of the
build. Separate the build from the migration instead:

1. Snapshot branch from `main`. Verify it exists before anything else.
2. **Capture the rollback target by ID** — the deployment the custom domain
   points at *right now* (`vercel alias ls`), not "whatever was latest".
3. Remove `RUN_MIGRATIONS` from Production. Record the value.
4. `vercel deploy --prod --skip-domain --yes` — builds, no traffic, no migration.
   Abort here if it fails; nothing has touched the database.
5. **Migration and promote as ONE chained command**, `&&` so the promote fires
   the instant the migration succeeds and not at all if it fails:
   ```bash
   cd apps/issues && DATABASE_URL='<main>' npx drizzle-kit migrate \
     && cd ../.. && vercel promote <deployment-url> --yes
   ```
   The inline `DATABASE_URL` wins over `.env.local` — dotenv never overwrites an
   already-set variable — so local dev cannot be hit by accident.
6. Verify against the **custom domain**, semantically, not for `200`s.
7. Re-add `RUN_MIGRATIONS=1` and confirm it is Production-only.

Two traps, both hit for real:

- **`--skip-domain` is partial.** It protects the *custom* domain but not the
  project's default `.vercel.app` aliases, which go live immediately. In Phase 3
  the new build served broken against the old schema on
  `bc-issues-…vercel.app` while `issues.blackcode.ch` correctly stayed on the
  old deployment. Harmless only because nothing points at that alias. Read it as
  *"custom domain unchanged"*, never as *"serves no traffic"*.
### Step 4b — test the staged build with the REAL binary, before promoting

Added after the Phase 7 incident, 2026-08-05. **This step is not optional for
any change that touches a path the CLI takes.**

Earlier phases recorded "Deployment Protection blocks `bk` from authenticating
against a deployment URL, so verify after the promote with the published
binary." That was accepted as a limitation. It is not one:

- Protection hides **preview** deployments. A **production-target** deployment
  (`vercel deploy --prod --skip-domain`) is **publicly reachable** — it just has
  no domain pointing at it.
- `bk` reads its server from config, and `BK_CONFIG_DIR` can redirect that.

So the staged build can be exercised by the exact binary your agents run,
*before* it takes traffic:

```bash
mkdir -p /tmp/bk-stage
sed 's#"server": *"[^"]*"#"server": "https://<deployment-url>"#' \
  ~/.config/bk/config.json > /tmp/bk-stage/config.json
BK_CONFIG_DIR=/tmp/bk-stage bk upload ./somefile.png
BK_CONFIG_DIR=/tmp/bk-stage bk storage list | head
```

No bypass secret is involved.

**What it costs to skip it.** Phase 7 made uploads require an `<app>/<ws>/`
pathname prefix, on the assumption that the client-direct Blob flow was the
browser's alone. `bk` uses it too, so the promoted build rejected **every
installed binary** — a total outage of agent uploads. `/api/status` was green
throughout, because a health check exercises the server's own code paths, not a
client's. Only the real binary could have found it, and the real binary was
available all along.

The rule this generalises to: **a health check proves the server is up; only the
client your users run proves the contract still holds.**

- **`vercel promote` and `vercel deploy --prod` may be blocked** by an agent's
  permission classifier. **Probe the blocked command before touching the
  database** — promoting the already-live deployment is a no-op and reveals the
  block for free. Phase 3 did exactly this and turned a would-be outage into a
  handoff.

The same partiality is also an asset: **the bare `.vercel.app` project alias is
a free pre-promote staging URL.** Because `--skip-domain` points it at the new
build while the custom domain still serves the old one, the full verification
sweep — login, endpoints, semantics, a real write — can run against the new code
*before* promoting. Use it every time; a promote should confirm what you already
know, not be the first test.

### Who owns the migration depends on the ORDER — decide it explicitly

Learned the hard way in Phase 6, 2026-08-05. `RUN_MIGRATIONS=1` means
**`vercel deploy --prod` applies pending migrations during `postbuild`.** Which
ordering you use therefore decides who runs the migration, and getting this
wrong runs it before you have gated it:

| Ordering | Who migrates | `RUN_MIGRATIONS` |
|---|---|---|
| **migrate-first** (Phase 3: the migration breaks running code, so migrate and promote must be chained) | you, by hand | safe to **leave set** — `postbuild` finds nothing pending |
| **deploy-first** (Phases 4, 6: the migration is additive, so you want a gate between migrating and promoting) | **`postbuild`, silently, during the build** | **MUST be removed before the deploy**, and restored after |

In Phase 6 the plan said deploy-first *and* "leave `RUN_MIGRATIONS` set" — a
sentence carried over from the migrate-first ordering without rechecking it. The
deploy applied 0035 itself, before the count/drift gate ran. It was benign
**only** because 0035 was additive, which is the property that had been verified
up front. With a destructive migration it would have been an outage.

So: **step 3 of the cutover pattern — remove `RUN_MIGRATIONS`, record the value —
is not optional in deploy-first ordering.** It is the step that decides who owns
the migration.

Two corollaries:

- The Drizzle ledger's `created_at` is the **journal** timestamp (when the file
  was generated), not when it was applied — it cannot date an application. The
  Vercel build log is the only witness for when a migration actually ran.
- Verify *after* the deploy that the migration count is what you expect. If it
  moved and you did not move it, `postbuild` did.

**Two credentials, not one.** `RUN_MIGRATIONS=1` makes `postbuild` migrate using
`DATABASE_URL`. Once that points at a bounded app role, every deploy fails —
correctly, because the app role has no DDL and cannot read
`drizzle.__drizzle_migrations`. Production therefore carries both:

| Var | Role | Used by |
|---|---|---|
| `DATABASE_URL` | `issues_app` (DML only, owns nothing) | app runtime |
| `MIGRATE_DATABASE_URL` | `neondb_owner` | `postbuild` migrations only |

Keep a fallback to `DATABASE_URL` so local dev needs no second variable. Every
future app repeats this pair.

## Releasing the CLI: web deploy, then npm, then web deploy AGAIN

Found in Phase 5, 2026-08-05. It applies to every future CLI release.

`devops/release.sh cli` bumps `CLI_LATEST_VERSION` in `apps/issues/lib/cli-version.ts`
**in a commit it creates itself**. That commit therefore lands *after* the web
deploy, so production keeps advertising the previous version in
`x-bk-cli-latest` — and no installed client is told an update exists. Since the
"update available" nudge is the adoption signal that has to precede any
`CLI_MIN_VERSION` raise, a stale header quietly stalls the next release cycle.

The order:

1. **Deploy web first.** The new server must be backwards compatible with the
   *old* clients that are still installed. The reverse is not true — a new
   client against an old server fails in ways the user sees.
2. **`./devops/release.sh cli minor`** — answer **`normal`**, never `forced`.
   `forced` raises `CLI_MIN_VERSION`, which is Phase 8's decision.
3. **Deploy web AGAIN** to pick up the version bump, and verify:
   ```bash
   curl -sI https://issues.blackcode.ch/api/meta | grep x-bk-cli
   ```
   `x-bk-cli-latest` must equal the version now on npm.

Do **not** paper over it with `BK_CLI_LATEST` in Vercel. The env override exists
for emergency rollback of the advertised version, not for routine releases —
using it here creates a second source of truth that goes stale the moment
someone forgets to clear it.

## OWED BEFORE APP #2: cross-deployment blob reference checking

Found in Phase 7, 2026-08-05. **This is a hard blocker on shipping a second
app**, and the "add an app" checklist in Phase 8 is incomplete until it is
resolved.

Phase 7's scanner registry fails **closed against `platform.apps`**: a blob may
be deleted only when every enabled app has proven it holds no reference. That is
the correct safety property — a delete you cannot justify is one you must refuse.

But the app boundary makes the proof impossible across deployments. Per-app
Postgres roles (§4.3) mean the `issues` deployment cannot read `sales.*`, so it
can never prove a file is unreferenced by sales. The moment a second row lands
in `platform.apps`, **blob deletion in the issues deployment stops working
entirely** — correctly, and uselessly.

The answer is not to loosen the gate. Three ways to actually close it:

| Option | Shape | Cost |
|---|---|---|
| **A — a maintained index** (recommended) | `platform.blob_references (url, app, source_urn)`, written **in the same transaction** as the content change that creates or removes a reference. Any app can then read the whole picture without reading another app's tables. | Exactly the `platform.entities` pattern from Phase 6 — same drift risk, same mitigation: a reconciler (`bk super-admin blob-drift`). |
| B — cross-app HTTP | The deleting app asks each other app's API "do you reference this URL?" | Needs service-to-service auth, and a down app blocks deletion. |
| C — a central sweeper | Only one job, holding read access to every schema, ever deletes. Apps mark candidates and never call `del()`. | Simplest safety story; adds a component and a schedule. |

**A is recommended** because the precedent already exists and is proven: Phase 6
projects `platform.entities` in-transaction and reconciles with
`bk super-admin entity-drift`. Reference tracking is the same problem with the
same solution, and it keeps deletion synchronous.

Until this ships, `platform.apps` must contain exactly one row.

## Decisions taken during the migration

**No continuous deployment; Vercel stays disconnected from GitHub.** (Decided
2026-08-04, during Phase 1.) Deploys are deliberate and manual — `vercel` for a
preview, `vercel --prod` for production — which is how this project has always
shipped.

Consequences, all accepted:

- Preview deployments are created from the CLI (`vercel`, no `--prod`), not by
  pushing a branch. Every phase's "click through a preview" step uses that.
- Preview env vars are set in the dashboard against the Preview environment.
- `ignoreCommand: npx turbo-ignore` in `apps/issues/vercel.json` is a **no-op**,
  because it only runs on Git-triggered builds. It is kept, not removed, so
  per-app filtered builds work the day CD is ever wanted.
- `git.deploymentEnabled.main = false` is likewise inert but kept as a safety
  net against an accidental future Git connection.

Do not re-propose connecting Git as a prerequisite for anything. If a later
phase seems to need it, the need is `turbo-ignore`, and the answer is that
manual deploys already choose what ships.

**Preview deployments: same project, four phases only.** (Decided 2026-08-04.)

A preview is **not a separate Vercel project** — it is the same project deployed
to a different target (`vercel` vs `vercel --prod`). No second project, no extra
project cost. What costs something is the preview *environment*: its own Neon
branch and its own Blob store.

Preview environment variables — the deliberate minimum:

**Provisioned 2026-08-04.** All three are set on the Preview environment of the
`bc-issues` Vercel project; Production values are untouched.

| Var | Value |
|---|---|
| `DATABASE_URL` | Neon branch `preview` (`br-proud-bread-assgcqxc`) — never `main` |
| `NEXTAUTH_SECRET` | **preview-only, freshly generated** — not Production's |
| `BLOB_READ_WRITE_TOKEN` | store `blackcode-platform-preview-blob` (`store_NLDwCIb2ZGX0rzF9`, public, fra1) |

Two decisions differ from the first draft of this section:

- **`NEXTAUTH_SECRET` is generated, not reused.** Reuse was proposed so a session
  would carry across, but preview runs on `*.vercel.app` and production on
  `blackcode.ch` — cookies never cross those origins, so sharing the secret buys
  nothing and needlessly widens what a preview deploy can mint.
- **`NEXTAUTH_URL` is deliberately unset on preview.** Every CLI preview deploy
  gets a unique hostname, so any static value would be wrong for most of them.
  next-auth v4 infers the URL from `VERCEL_URL` on Vercel. The only direct reads
  of `NEXTAUTH_URL` in the codebase build absolute URLs for outbound email, and
  email is disabled on preview anyway.

Deliberately **not** set: `RESEND_*` and `GOOGLE_CLIENT_ID`/`SECRET`. Email and
Google login therefore do not work on preview; both are exercised on production
instead. `RUN_MIGRATIONS` is Production-only and must never be set on preview.

When connecting a Blob store, always pass `--environment preview` explicitly.
The default connect flow injects `BLOB_READ_WRITE_TOKEN` into every environment,
which would point production at the empty preview store.

The Blob store is separate for a specific reason, not tidiness:
`sweepOrphanedUrls` in `lib/blob-gc.ts` runs on **user action** — hard-deleting a
comment, purging from trash — not on a schedule. With a shared store and a
drifted preview database, a purge on preview deletes bytes production still
references. Click-throughs include file upload, so this path gets exercised.

**When a preview deploy is required:**

| Phase | Preview? | Why |
|---|---|---|
| 2 — extract packages | skip | no schema change; local + production is enough |
| 3 — schema move | **required** | code against an unmigrated database fails instantly; production is not an acceptable first try |
| 4 — access enforcement | **required** | this is the phase that can lock the team out |
| 5 — agent surface | skip | CLI-side; no schema change |
| 6 — cross-app primitives | **required** | adds migrations |
| 7 — storage | **required** | adds migrations, touches blob deletion |
| 8 — harden | optional | judgement call |

**Phase 2 extracts three packages, not six.** (Decided 2026-08-04, during
Phase 2.) The plan assumed all six `platform-*` packages could be extracted
before Phase 3. They cannot: three are blocked behind work already scheduled for
a later phase, and forcing them now would mean doing that later phase early,
badly, and without its migration.

| Package | Lands in | Blocked by |
|---|---|---|
| `platform-db` | **Phase 2** ✅ | — |
| `platform-api` | **Phase 2** ✅ | — |
| `platform-ui` | **Phase 2** | — |
| `platform-auth` | **Phase 6** | `events.ts` hardcodes `issues`/`projects`/`tasks`; generalising it *is* Phase 6's `app` + `subject_urn` work |
| `platform-storage` | **Phase 7** | `blob-refs.ts` scans six app tables by name; Phase 7 replaces it with per-app registered scanners |
| `platform-agent` | **Phase 5** | `agent-meta.ts` reads app enums; Phase 5 is where `bk meta` regroups under `apps.*` |

The plan's "2 before 3" constraint only ever genuinely required `platform-db`,
because it owns the platform schema that Phase 3 creates. That is done.

**Consequence for Phase 3:** it also drops the vestigial `comments.issue_id`
column in its first migration. `comments` is a platform concept and already
polymorphic, but that live FK to `issues` is a platform→app dependency that
would break `pg_dump --schema=issues`, the clean extraction path Phase 8
rehearses. The data is fully backfilled (291 rows, zero without `parent_type`,
zero where `issue_id` disagrees with `parent_id`) and four code sites write or
read it. Doing it inside Phase 3 moves `comments` to both the package and the
`platform` schema in one step instead of two.

The one thing a preview catches that a local dev server cannot is **serverless
bundling**. Phase 1's `lib/changelog.ts` reading `../../docs` — a path outside
the app directory — is the archetype: it works locally without question, and
whether it survives Next's file tracing into a serverless bundle is a separate
fact. Trace files are good evidence; a real deploy is proof.

**Five decisions taken in Phase 4.** (2026-08-04.)

1. **`packages/platform-auth` was created now, containing only per-app access.**
   The Phase 2 table defers `platform-auth` to Phase 6, and that still holds — it
   is about extracting `lib/auth.ts`, which is blocked behind `events.ts`. But
   `requireAppAccess` had to live somewhere, and the layering decided it: the data
   layer is in `platform-db` (where the tables are, no HTTP knowledge), while the
   enforcement wrapper needs `platform-api`'s `Errors`. Putting that in
   `platform-db` would invert the dependency (db → api); leaving it in
   `apps/issues` would mean app #2 copies its own access check. So the package
   exists with one tenant, and Phase 6 moves the session/token half in beside it.

2. **Enforcement defaults to ON; `PLATFORM_ENFORCE_APP_ACCESS=0` is the way off.**
   Opt-in would make the intended behaviour depend on remembering to set a
   variable in every environment — and the environment where you forget is the one
   that silently stops checking. Opt-out means no environment needs configuring
   for the safe behaviour, and recovery is one variable to ADD rather than a code
   change. The switch gates the visibility filter as well as the 403, so flipping
   it restores pre-Phase-4 behaviour completely.

3. **`app_access`'s foreign key is to `workspace_members(workspace_id, user_id)`,
   not to `workspaces`.** This makes "access without membership" unrepresentable
   and makes removing a member drop their access by cascade rather than by
   remembering to — so the *next* membership-removal path cannot get it wrong.
   Both were verified on the rehearsal branch, including that Postgres accepts the
   composite FK against the existing unique index. Workspace deletion still
   cascades through `workspace_members`, so no second FK is needed.

4. **`bk meta.apps` is an OBJECT keyed by slug, not an array.** Phase 5 moves each
   app's vocabulary and limits *inside* its entry (§7.4). Keyed makes that
   additive; an array would have to be replaced — breaking a field agents had
   already been parsing for a release, which is exactly what this sequencing
   exists to avoid. Phase 5 should add to `apps.issues`, not reshape `apps`.

5. **An app cannot be disabled from inside itself** (`cannot_disable_current_app`).
   Disabling an app revokes every member's access to it — including the owner's,
   and including access to the route needed to undo it. It is an irreversible
   action behind one toggle, and `--confirm`-style repetition does not help: the
   problem is not whether the caller means it, it is that there is no way back.
   The toggle stays real for every other app, which is the case it exists for. Same
   reasoning gives `cannot_revoke_owner`.

**A note for whoever reads the orphaned-member query after Phase 4.** It is a
pass/fail gate only in the window *before* enforcement, where every member was
just backfilled and a row means someone is about to be locked out. Afterwards a
member with no grant is exactly what `invite_only` and a deliberate revoke
produce, so the same query becomes a *report* of who lacks access, not a defect
list. `findOrphanedMembers` in `platform-db` is that query as code.

**Three decisions taken in Phase 7.** (2026-08-05.)

1. **The reference registry fails closed against `platform.apps`, not against
   itself.** The obvious registry answers "does any registered scanner claim
   this file?" — and then "no scanner registered" is indistinguishable from "no
   references", which is a silent path to `del()`. So coverage is checked against
   the *database's* list of enabled apps: an enabled app with no registered
   scanner makes every reference answer an error. The deliberate consequence is
   that **once a second app is registered, blob deletion in the issues deployment
   refuses until that app's scanner is registered in that process.** That is
   correct rather than unfortunate: per-app Postgres roles (§4.3) mean one
   deployment genuinely cannot read another app's tables, so it cannot prove a
   file is unused, and a delete it cannot justify is one it must refuse. Making
   deletion work across deployments is a cross-app protocol — a scan cannot do
   it — and it is not built. **Phase 8 or later owes this an answer before app #2
   ships**, and the answer is not "loosen the gate".

2. **`lib/upload.ts` stayed in `apps/issues`.** The standing rule is to extract
   only what a second app needs *unchanged*. The ledger, the paths, the
   recognizer, the registry and the GC qualify and moved. The client-side
   uploader does not: making it generic means parameterising the app slug, the
   size cap and the block list, at which point it is a factory the app has to
   configure rather than a library it can use. It is ~40 lines; a second app
   copying them is cheaper than the wrong abstraction. `file-attachment.ts` was
   named in the Phase 7 brief too, but it was already extracted — to
   `platform-ui`, in Phase 2 — and moving it to `platform-storage` would be
   churn: it is the rich-text node's wire format, which is a UI fact.

3. **Existing blobs were not moved, and the ledger is the only attribution.**
   New uploads go under `<app>/<workspace>/<file>`; everything older stays flat at
   the store root. `pathname` records where a file *is*, `uploads.app` records who
   *owns* it, and `appFromPathname` returns null rather than guessing for an
   unprefixed path. Moving ~700 live files to make a prefix uniform would risk
   real data to satisfy a cosmetic invariant, and every url is absolute anyway —
   nothing reads the prefix to find a file.

## What is explicitly out of scope

- Building sales, CRM or bookkeeping.
- An MCP server (noted in the architecture doc; decide after Phase 8).
- Per-app billing or a public multi-tenant signup.
- Splitting the `users` table or any form of SSO beyond the shared cookie.
