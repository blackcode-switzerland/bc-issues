# Adding an app

**The authoritative guide.** Self-contained: you should be able to follow this
top to bottom without having seen this repo before. For *why* the platform is
shaped this way, see [`2026-08-platform-migration.md`](2026-08-platform-migration.md);
for the current design rules, [`platform-architecture.md`](platform-architecture.md).
Neither is required reading to finish this document.

Steps 1–6 have been **walked end to end**, on 2026-08-05, by creating a throwaway
`apps/sales` from the scaffold and following this document top to bottom. It found
two real bugs. Timings, what broke, and what was NOT walked are at the bottom —
read that section before trusting the rest.

> **Copy `apps/_template`.** It is a real app: one entity, one route, one CLI
> command group, one guide topic, one page. It builds, lints and passes the
> parity guard. Do not start from `apps/issues` — you will inherit eleven tables
> and a dashboard you then have to delete.

Two rules before you start:

- **The slug is one string in six places.** Directory, `lib/app.ts`, Postgres
  schema, `platform.apps.slug`, the CLI namespace, the guide topics directory.
  Nothing derives it from anything else, deliberately — a slug inferred from a
  directory name is a slug that changes when someone moves a folder.
- **Nothing here is optional except where it says so.** Every step exists
  because skipping it fails later and further away.

---

## 0. What you are building on

### What the platform gives you

Seven packages under `packages/platform-*`. **Apps import these; apps never
import each other.**

| Package | What it gives you |
|---|---|
| `platform-db` | The Drizzle schema and client factory for the `platform.*` tables — users, workspaces, members, app access, uploads, comments, labels, events, entities, links, the blob-reference index. Plus the platform-owned WRITES you must not reimplement: `recordPlatformEvent` + the platform fan-out (D-23), `createInboxMessage`, and the four sign-in callbacks (`getUserByEmail`, `touchLastLogin`, `upsertUserFromOAuth`, `materializePendingInvitationsForUser`) |
| `platform-api` | The HTTP plumbing: the shared `apiHandler` / `resolveWorkspace` behind an `AppContext`, **the platform route factories** (`@blackcode/platform-api/routes`), per-app access enforcement (`requireAppAccess` — the 403 with a hint), the `Errors` envelope (`{ error, code, suggestion? }`), `jsonList()` → `{ data, next_cursor }`, cursor pagination, log sanitisation, platform-wide limits |
| `platform-auth` | Identity, and only identity: API tokens, password handling, the platform whitelist. No HTTP — `requireAppAccess` moved to `platform-api` on 2026-08-06, because its whole job is constructing a 403 |
| `platform-ui` | The design system: `components/ui/` primitives, the TipTap rich-text editor and its media companions |
| `platform-storage` | The upload ledger, app-prefixed paths, the per-app reference-scanner registry, and the GC **that will not delete a file any app still references** |
| `platform-agent` | The merged changelog feed and the advertised CLI version floor |
| `platform-testing` | The two guards every app copies: the CLI-parity harness and the app-isolation checks (`findCrossAppImports`, `findCrossSchemaQueries`) |

**When does something belong in a package rather than your app?** One question:

> **Would another app need this *unchanged*?**

Yes → `packages/platform-*`. No → keep it in your app. "Nearly unchanged" is a
no. The test is **two real apps needing it unchanged**, not one app and a guess.

`apiHandler` and `resolveWorkspace` are the worked example of that rule running
its full course. They were deliberately duplicated in the scaffold for one whole
app's lifetime, under a header saying so and naming the trigger — "when a REAL
second app lands". On 2026-08-06 it landed, and they moved to `platform-api`
behind an `AppContext` (`docs/sales-app-plan.md` Phase 1a, D-2). Waiting cost
nothing; extracting early would have baked one app's shape into the interface.

**So you inherit them, and you no longer write them.** Your `lib/api.ts` is the
four lines of `appContext` and two binds — copy `apps/_template/lib/api.ts`.

This cuts the other way too, and the migration learned it the expensive way:
before reshaping a shared table so more apps can use it, ask whether they should
be sharing it at all. `workspace_counters` was going to become
`(workspace_id, app, entity_type, last_seq)`; it moved to
`issues.workspace_counters` instead, because sharing a counter buys nothing and
costs a shared write point and a shared migration per entity type.

### The boundary rules

Three, and the third is enforced by the database rather than by review.

1. **`platform.*` is shared.** Your app may read, write and FK into it freely.
2. **Your schema is yours.** `sales.*` is unconstrained — nobody else can see it,
   so its migrations need no coordination. Platform-schema changes are the
   opposite: expand → migrate → contract, because apps deploy independently and a
   breaking `platform.*` change breaks every other app for the length of the
   window.
3. **You may not read another app's schema.** Not "should not" — *may not*. Each
   app connects as its own Postgres role, and `sales_app` has no `SELECT` on
   `issues.*`. Cross-app reads go through that app's HTTP API, or through
   `platform.links` / `platform.events`.

Two guards back this up inside the repo, and both are copied into your app:
`lib/app-isolation.test.ts` (no import resolving into another app, no query
naming another app's schema) and `lib/cli-parity.test.ts`. There is deliberately
**no ESLint rule** for the import half — one existed, it was a glob over import
strings, and it never matched the shape that actually escapes an app. Do not add
one back.

### The agent surface

Humans use the web UI. **Agents use one interface: the `bk` CLI.** The HTTP API
under `apps/<app>/app/api/**` is private plumbing with no public contract — do
not document it for external consumers and never add an OpenAPI spec.

Three entry points, and your app inherits all three:

| Entry point | Answers | Lives in |
|---|---|---|
| `bk guide` | *How does this tool behave?* — flags, exit codes, workflows | `cli/internal/guide/topics/`, embedded in the binary |
| `bk meta` | *What is the data right now?* — vocabularies, limits, workspaces | the server, `GET /api/meta` |
| `bk changelog` | *What changed, and how do I adapt?* | `docs/changelog/*.md` |

The rule that keeps them coherent: **a guide topic never restates a value that
`bk meta` carries.** Static behaviour ships in the binary; dynamic data comes
from the server. `guide_test.go` fails the build on a hardcoded vocabulary or
size limit.

**Every change lands in three places, in the same commit:**

> **route → `bk` command (+ its `routes` annotation) → changelog entry.**

Plus a conditional fourth: a guide topic, *only* if agent-visible behaviour
changed. If only a value changed, edit its source — `bk meta` serves it live.

**Commands are namespaced per app**: `bk sales deal create`, never `bk deal
create`. Three tiers decide the spelling (D-11, `bk guide platform/apps`):

| Tier | Verbs | Spelling |
|---|---|---|
| Neutral — same answer from any app | `login` `logout` `meta` `guide` `changelog` `skill` `version` `app` `workspace` `member` `invite` `token` `profile` `inbox` `super-admin` | bare |
| Cross-app — spans every app by design, results tagged | `search` `activity` `link` `storage` | bare |
| App-owned — the answer depends on the app | your nouns, **plus** `upload` `trash` `label` | `bk <app> <verb>` |

The test is *"would two deployments answer differently?"*, never *"is it shared
code?"* — `storage` is shared code AND cross-app, because uploads are one ledger
against one workspace quota (D-28). You upload INTO one app and list ACROSS all
of them.

The app-owned platform verbs are shared code in `cli/internal/appverbs`. Your
group mounts them in one line:

```go
cmd.AddCommand(appverbs.New(appverbs.Config{App: Slug, TrashTypes: […]}).All()...)
```

Forget it and your own `lib/cli-parity.test.ts` fails: `POST /api/upload` is
real in your tree and no `bk` command claims it.

Registering the group in `root.go` is also what PINS its server: everything under
`bk <app> …` resolves through `app_servers[<app>]`, learned from your
`platform.apps.base_url` (§3). Nothing else is needed — but if that column is
NULL, every command in your group fails with *"no server known for app …"*
rather than quietly reaching somebody else's deployment.

---

## 1. The app directory

```bash
cp -R apps/_template apps/sales
cd apps/sales
```

Then rename, in this order:

| File | Change |
|---|---|
| `package.json` | `"name": "sales"` |
| `lib/app.ts` | `APP_SLUG = 'sales'`, and delete the note about the scaffold's underscore |
| `lib/db/schema.ts` | `pgSchema('sales')`, and rename `templateSchema` |
| `lib/cli-parity.test.ts` | nothing — it reads `APP_SLUG` |
| `lib/app-isolation.test.ts` | `OTHER_SCHEMAS` — list every OTHER app's schema |
| `next.config.js` | nothing, unless you add a platform package |

Add the new app's schema to **every other app's** `OTHER_SCHEMAS` too. That is
the one edit outside your own directory, and it is what makes the isolation
guard symmetric.

```bash
npm install          # only needed if you also added a new packages/ workspace
npm run typecheck    # should pass before you write a line
```

## 2. The Postgres schema, role and grants

Read [`platform-db.md`](platform-db.md) first — it explains the two credentials
and why the app role owns nothing.

```sql
CREATE SCHEMA sales;
```

Then run `docs/sql/app-role.sql` as `neondb_owner`, substituting the slug and a
generated password. **Do not skip step 5b** (revoke write on
`platform.blob_references`, leave `SELECT`).

**Then prove the boundary, as the new role:**

```bash
psql "postgres://sales_app:<pw>@<host>/<db>" -f docs/sql/app-boundary-probe.sql
```

Every deny must be `42501`.

> **This is a manual provisioning step, and it cannot become a CI test.** That is
> not laziness about automation — the properties it checks are only observable
> from a session **authenticated as** the app role, and CI has no app-role
> credential. `SET ROLE` from the owner is not a substitute and quietly gives the
> wrong answer: `session_user` ignores `SET ROLE` by design, and inside a
> `SECURITY DEFINER` function `current_user` is the function's *owner*, never the
> caller. That exact mistake is why the probe exists — `platform.blob_refs_purge`
> guarded on `current_user` and was therefore true for everybody, so any app
> could purge any other app's blob references. Nothing but running this as the
> real role would have shown it.
>
> So: **run it by hand when you provision the role, and again whenever you change
> a grant.** Check (2) reports `SKIPPED` loudly if yours is the only app schema —
> that is correct, not a pass. See `platform-db.md`.

## 3. The row in `platform.apps`

```sql
INSERT INTO platform.apps (slug, name, description, base_url, enabled)
VALUES ('sales', 'Sales', 'Deals and quotes', 'https://sales.blackcode.ch', true);
```

**`base_url` is load-bearing since CLI 3.0.0 (D-1).** It is what `bk login` and
`bk meta` learn each app's address from, and the CLI refuses to guess: with the
column NULL, `bk sales …` fails with *"no server known for app sales"* on every
machine, however correct everything else is. Set it to the real deployment URL in
this row — not later, not in a follow-up. `bk app list` is where you check it.

**Read this before you run it.** The moment this row exists, every deployment's
blob-delete gate asks whether `sales` references a file. Until step 4 gives it an
answer, **blob deletion refuses everywhere** — correctly, because nobody can
prove a file is unused. That is not a bug; it is the gate working.

So either do steps 3 and 4 together, or insert with `enabled = false` and flip it
when the triggers are in.

## 4. Blob-reference triggers — for any content that can hold a file URL

If any column of your app can contain an uploaded file's URL — a description, a
body, a comment, an attachment row — it needs a trigger, in your app's first
migration. Copy the shape from `apps/issues/lib/db/migrations/0037_blob_reference_index.sql`:

```sql
CREATE TRIGGER trg_blob_refs
  AFTER INSERT OR DELETE OR UPDATE OF body ON sales.quotes
  FOR EACH ROW EXECUTE FUNCTION platform.blob_refs_sync('sales', 'quote', 'workspace_id', 'scan', 'body');
```

…then, **at the bottom of the same file, after the backfill**:

```sql
UPDATE sales.quotes SET body = body WHERE body IS NOT NULL;   -- backfill by re-triggering
UPDATE platform.apps SET maintains_blob_index = true WHERE slug = 'sales';
```

Order matters: setting the flag before the backfill advertises an empty index as
authoritative, which is how a file still in use gets deleted.

> **THIS IS THE ONE STEP THAT IS EASY TO FORGET AND EXPENSIVE TO MISS.** The
> index is trigger-maintained precisely so no *write path* can forget it — which
> moves the whole risk to here, to adding a content column without a trigger.
> **Every time you add a column that can hold a URL, add its trigger in the same
> migration.** Nothing will remind you: `bk super-admin blob-drift` compares the
> index against a live scanner, and an app with no scanner has nothing to compare
> against.

## 5. The CLI command group

```bash
cp -R cli/internal/commands/template cli/internal/commands/sales
cp cli/internal/client/template.go cli/internal/client/sales.go
```

- Rename the package and `Use: "sales"`.
- Register it in `cli/internal/commands/root.go` — one line beside
  `issues.NewGroup()`.
- **Every leaf command needs a `routes` annotation**, or the literal `"none"`.
  `cli/internal/commands/routes_test.go` fails the build otherwise.
- Command packages must not import each other (`boundaries_test.go`). Anything
  two need goes in `cmdutil`.

```bash
cd cli && go build ./... && go test ./... && make routes
```

## 6. Guide topics

```bash
mkdir cli/internal/guide/topics/sales
```

At least one topic, with a `# Title`, a summary line and a `Related commands:`
line — `guide_test.go` checks all three. Two more rules it enforces:

- **Never state a dynamic value** (a status name, a byte cap). Write "run
  `bk meta`" instead. A guide ships inside the binary; a value does not.
- **A topic under `topics/<app>/` may not describe another app.** Shared
  behaviour belongs in `topics/platform/`.

This directory is also what gives your CLI routes their app attribution — the
parity guard reads `guide.AppSections()`. An app with no topics directory has its
routes attributed to `platform`, and its parity test will tell you so.

---

> ## ⚠️ STEPS 7–10 ARE UNVERIFIED
>
> Everything above was walked on 2026-08-05. **Steps 7 to 10 were not**, and
> deliberately: they need a Vercel project, a subdomain and DNS for an app that
> must never be deployed — a real resource with a real chance of being forgotten,
> to test four steps that are ordinary platform mechanics rather than anything
> this architecture invented.
>
> **Whoever ships the first real app must walk them and update this document**
> with the date and the app name, replacing this box. Until then, treat 7–10 as a
> best-effort reconstruction from how `apps/issues` is configured, not as
> instructions anyone has followed.
>
> | | |
> |---|---|
> | Walked | steps 1–6, 2026-08-05, against a throwaway `apps/sales` |
> | Unverified | steps 7–10 |
> | Closed by | *(first real app — put your name, the app and the date here)* |

## 7. `docs/changelog/sales.md`

One file. It is discovered by reading the directory, so there is no registry to
update — `bk changelog` and `GET /api/changelog` pick it up automatically.

## 8. Vercel project

- **Point it at the EXISTING Neon project and Blob store.** One database, one
  store, per-app schemas and per-app path prefixes. A second Neon project breaks
  every cross-app query (`bk search`, `bk activity`, the blob index) and a second
  Blob store breaks attribution.
- **Root Directory:** `apps/sales`.
- Environment: `DATABASE_URL` (the `sales_app` role), `MIGRATE_DATABASE_URL`
  (`neondb_owner`), `NEXTAUTH_URL`, `NEXTAUTH_SECRET`,
  `BLOB_READ_WRITE_TOKEN`, and `RUN_MIGRATIONS=1` **Production only**.
- `turbo-ignore` so a commit touching only another app does not rebuild this one.

## 9. Subdomain and cookie domain

`sales.blackcode.ch`. If you want one session across apps, the session cookie has
to move to `.blackcode.ch` — which **signs everyone out once**. Schedule it at a
quiet hour and put it in the changelog. It has been deferred since Phase 4 and is
still not done; check its status before assuming single sign-on works.

## 10. `apps/sales/docs/`

`backend.md` and `frontend.md` for this app only. Root docs never describe an
app's internals; an app's docs never describe another app
(platform-architecture.md §7.5).

## 11. What the scaffold deliberately leaves out

Two things a real app adds, each needing a decision only you can make:

- **Entity projection.** Write into `platform.entities` in the same transaction
  as the source row, and your entities become `bc:sales:acme/quote/7` — findable
  by `bk search`, linkable by `bk link`. Copy
  `apps/issues/lib/db/queries/entities.ts`; read its header first.
- **A browser session.** The scaffold authenticates bearer tokens only, which is
  the path agents use. NextAuth config is genuinely app-specific — see the note
  in `packages/platform-auth/src/index.ts`. Until you add one, do not mount
  `/api/tokens`: it requires `AppContext.resolveSessionUser` and throws at import
  time without it, on purpose.

  **What those callbacks DO to the database is not app-specific, and is already
  written.** `getUserByEmail`, `touchLastLogin`, `upsertUserFromOAuth` and
  `materializePendingInvitationsForUser` come from `@blackcode/platform-db` —
  there is one login for every app, so a second copy is a second chance to
  swallow somebody's pending invitations. What you write yourself is
  `authOptions` (your providers, your cookie, your redirect pages) and your own
  `createWorkspace` / `ensureDefaultWorkspace`, because each app has its own
  post-create step.

- **Anything that records an event.** Use `recordPlatformEvent(tx, { app, … })`
  from `@blackcode/platform-db` for workspace / membership / app-access /
  invitation events; write your own `recordEvent` only for your own entity types,
  and delegate the platform ones to it in ONE place. Two rules, both load-bearing
  (see `docs/backend.md` → *The seam*): pass your `APP_SLUG` rather than a
  literal — `platform.events.app` is the **producing** app — and never handle the
  five platform fan-out actions in your own `fanOutEvent` as well, or every
  invitation notification is delivered twice.

**An error log used to be a third item here.** It no longer is: the shared
`apiHandler` writes to `platform.error_events` for every app that uses it, so
`bk super-admin errors` covers you from your first commit. That is the point of
the extraction — a thing on a checklist is a thing an app can forget, and an app
that forgets its error log has no error log and nothing goes red.

### Which platform routes to mount

`@blackcode/platform-api/routes` exports one factory per shared route. Mount the
ones your app serves, in your own tree, three lines each — Next routes by
filesystem, so there is no central mount and nothing warns you about one you
skipped. `lib/cli-parity.test.ts` is what catches it, and it will also make you
set `hostsPlatformRoutes` once you mount any of them.

## 12. Before you call it done

From the repo root:

```bash
npm run typecheck && npm test && npm run lint && npm run build
cd cli && go build ./... && go vet ./... && go test ./... && make routes
```

Your app's own tests must include, copied from the scaffold:

- `lib/cli-parity.test.ts` — every route reachable from `bk`, every claimed route
  real
- `lib/app-isolation.test.ts` — no import into another app, no query of another
  app's schema

**You do not need a third one for the shared packages.**
`packages/platform-testing/test/package-isolation.test.ts` scans every
`packages/platform-*/src` for a reference to any app's Postgres schema, and it
**derives the list of app names from each app's own `APP_SLUG`** — so your app is
covered the moment `apps/<you>/lib/app.ts` exists, with nothing to register. If
you ever see that test name your app's schema, the offending line is in shared
code and the fix is a platform table, not an exception.

> Why it exists: a raw-SQL `FROM issues.issues` inside a platform package
> compiles, lints and passes every other test — and then **works in the issues
> deployment and 42501s in yours**, because the boundary is a Postgres grant.
> It works where it was written and fails where it was not.

### Prove it fires — three steps, not two

The standing rule in `CLAUDE.md` is step 1. Steps 2 and 3 were added on
2026-08-06 because each was learned from a guard that had already passed step 1:

1. **Watch the check fail.** Break the thing it guards; restore.
2. **Ask what it would still pass on.** Wrong fixture, wrong wiring, empty input.
3. **Inject that regression and watch it again.**

Step 3 is not ceremony. The seam test in `apps/issues` was written by someone who
performed step 2, wrote a paragraph explaining why the fixture was sound, and was
wrong: every fan-out handler bails politely on an empty lookup, so the fake that
answered every read with `[]` made five assertions incapable of failing. The
suite passed 13/13 with the regression in place. Reasoning about step 2 is
reasoning, and you can be wrong in writing while feeling right.

The same shape appears in any check with an input: **assert that you found
something to check.** A scan over zero files and a filter over zero values both
report a confident green.

---

## What the walk actually cost

Walked 2026-08-05 by creating a throwaway `apps/sales` from the scaffold and
following this document top to bottom, with the database steps on a Neon
rehearsal branch. The app was deleted afterwards. Timings are from the person who
wrote the scaffold, so read them as a **floor**.

| Step | Wall clock | Notes |
|---|---|---|
| 1 — copy + rename | ~2 min | Six renames, all mechanical. `npm run typecheck` passed first try |
| 2 — schema, role, grants | ~1 min of SQL | The script runs as written |
| 2 — the boundary probe | ~10 min | Slowest step, and the one that found things |
| 3 — `platform.apps` row | seconds | And it immediately broke blob deletion, exactly as documented |
| 4 — triggers + flag | ~5 min | Two statements; the ordering is the whole content |
| 5 — CLI group | ~4 min | Copy, rename, register, `make routes` |
| 6 — guide topic | ~1 min | One `sed` |
| 7–10 | **not walked** | See below |

Total for steps 1–6: **well under an hour**, and most of it was the probe.

### What actually went wrong

**1. `bk __routes` deduped two apps' routes into one.** The worst of the four,
and only a walk could have found it. `CollectRoutes` keyed its map on
`method + path`, so when `sales` copied the scaffold's
`GET /api/workspaces/{ws}/notes`, the two collapsed and **`sales` appeared to
have no commands at all**. Its parity test then failed on the
"discovers both sides" assertion — which is the only reason this was visible
rather than a vacuous green. Two apps are two deployments; the same path is not
the same route. Fixed: the key now includes the app.

Fixing it also revealed that `GET /api/users` had been claimed by both
`bk issues issue list` and `bk user view`, and one of the two had been silently
dropped from the artifact all along.

**2. The boundary probe's most important check was commented out.** Check (2) —
"this app cannot read another app's schema" — had no second schema to point at
when it was written, so it shipped as a comment. A commented-out probe reports
success. It is now a `DO` block that finds another app's table via
`platform.apps` and **skips loudly** when there is none. Its first live run
picked `neon_auth.invitation` (a correct refusal of the wrong thing, which would
have read as a pass), which is why the candidate now comes from the app registry
rather than from a list of schemas to exclude.

**3. The `npm install` trap I expected did not happen.** A new app that only uses
existing packages resolves fine from the hoisted root `node_modules`. The install
is only needed when a NEW package appears. The instruction stays, the scare story
was wrong.

**4. `transpilePackages` and the lazy `createDb()`** — both real, both already
handled by the scaffold, neither cost anything on the walk because the scaffold
carries them. That is the scaffold doing its job.

### Not walked, and why

Steps 7 through 10 — changelog file, Vercel project, subdomain, app docs — need a
Vercel project, DNS and production credentials this walk deliberately did not
have, because the scaffold is not a product and must not be deployed.
**They are therefore the least-tested part of this document.** Whoever adds the
first real app should expect friction there and update this section from what
they hit.

### The registry rehearsal, done for real

Steps 3 and 4 were exercised end to end against the blob-delete gate, with a
second row in `platform.apps` on a rehearsal branch:

| State | Gate's answer |
|---|---|
| `sales` enabled, `maintains_blob_index = false` | **REFUSED** — `ReferenceCoverageError`, for every URL |
| triggers installed, flag set, index empty | answers again: file still referenced by issues → `true`; genuine orphan → `false` |
| `sales` content embeds the orphan | orphan → `true`, i.e. **deletion refused** |

The first row is the Phase 7 prediction reproduced deliberately: registering an
app before it can answer stops blob deletion platform-wide. That is the gate
working, and it is why step 3 says to insert with `enabled = false` if you are
not doing step 4 immediately.
