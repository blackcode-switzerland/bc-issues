# Adding an app

The ordered checklist. Steps 1–6 have been **walked end to end**, on 2026-08-05,
by creating a throwaway `apps/sales` from the scaffold and following this
document top to bottom. It found two real bugs. Timings, what broke, and what
was NOT walked are at the bottom — read that section before trusting the rest.

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

Every deny must be `42501`. `SET ROLE` from the owner is **not** a substitute and
reports the boundary as present when it is not — see `platform-db.md`.

## 3. The row in `platform.apps`

```sql
INSERT INTO platform.apps (slug, name, description, base_url, enabled)
VALUES ('sales', 'Sales', 'Deals and quotes', 'https://sales.blackcode.ch', true);
```

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
(PLATFORM-ARCHITECTURE.md §7.5).

## 11. What the scaffold deliberately leaves out

Three things a real app adds, each needing a decision only you can make:

- **Entity projection.** Write into `platform.entities` in the same transaction
  as the source row, and your entities become `bc:sales:acme/quote/7` — findable
  by `bk search`, linkable by `bk link`. Copy
  `apps/issues/lib/db/queries/entities.ts`; read its header first.
- **A browser session.** The scaffold authenticates bearer tokens only, which is
  the path agents use. NextAuth config is genuinely app-specific.
- **An error log.** `apps/issues/lib/api/handler.ts` records failures to
  `platform.error_events`; the scaffold just logs. Copy it when you want
  `bk super-admin errors` to see your app.

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
