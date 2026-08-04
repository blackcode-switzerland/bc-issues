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
5. **Set `search_path` explicitly** on the connection (`platform, issues`) — but
   still write schema-qualified in Drizzle. `search_path` is a safety net, not
   the mechanism.
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
   historical check can catch. Cover all of them with tests before enforcing:
   accepting an invitation, creating a workspace, the super-admin user tools,
   and OAuth first-login. Each must produce an `app_access` row (or an explicit
   `invite_only` denial) in the same transaction as the membership row.

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

## What is explicitly out of scope

- Building sales, CRM or bookkeeping.
- An MCP server (noted in the architecture doc; decide after Phase 8).
- Per-app billing or a public multi-tenant signup.
- Splitting the `users` table or any form of SSO beyond the shared cookie.
