# The platform migration — closing summary

Written 2026-08-05, the day Phase 8 shipped. This is the last artifact of the
migration and the first thing whoever adds app #2 should read.

It is deliberately not a list of what shipped — `PLATFORM-MIGRATION-PLAN.md` and
the changelogs already carry that. It is the record of **what went wrong, what
that cost, and what is still owed**, because that is the part that does not
survive in a diff.

---

## What the migration delivered

A single-app repo became a monorepo where **adding an app is a checklist**
(`docs/adding-an-app.md`) and **removing one is a rehearsed procedure**
(`docs/extracting-an-app.md`).

- Two apps: `apps/issues` (the product) and `apps/_template` (the scaffold,
  which is real — it builds, lints, and passes every guardrail).
- Seven shared packages, `packages/platform-*`. Apps import these; never each
  other.
- One database, `platform.*` + per-app schemas, with a bounded Postgres role per
  app. The app boundary is a **grant**, not a convention.
- Everything addressable: `bc:<app>:<workspace>/<type>/<number>`, projected into
  `platform.entities` in the same transaction as its source row.
- One Blob store, app-attributed, with cross-deployment reference counting that
  **fails closed**.
- One CLI, namespaced per app, with per-app parity guards proving every route is
  reachable.

## What it cost

**Nine phases.** One production outage (Phase 7: an upload path change rejected
every installed binary; `/api/status` was green throughout). **Eight guardrails
found green-but-inert.** **Four corrections to the plan's own instructions.**

---

## The one thing to take from this

> **A check is inert until you have watched it fail.**

Eight separate guardrails in this repo reported success while checking nothing.
Not one was noticed by reading it; every one was found by trying to break it.

| # | The check | How it was inert | Found by |
|---|---|---|---|
| 1 | ESLint on three packages | No config file at all — `eslint src` exited non-zero and `npm run lint` had been failing unnoticed. `platform-storage`, the one package that can reach `del()`, had **no boundary rule enforced** | Running `npm run lint` and reading the output |
| 2 | `blob_refs_purge`'s authorisation guard | Compared `current_user`, which inside a `SECURITY DEFINER` function is the **function's owner, not the caller**. True for everybody | Connecting as the real app role |
| 3 | `blob-drift-check.sql`'s orphan detection | Structurally impossible — an orphan is byte-identical before and after a re-fire, so a diff can never surface one | Injecting one of each fault kind |
| 4 | The `apps/<a>` → `apps/<b>` import rule | Three glob patterns matching **none** of the imports that actually escape an app. The climb has no fixed depth and `apps` never appears in the specifier | Writing the import it forbids and watching lint pass |
| 5 | `bk __routes` | Deduped on `method+path`, so two apps sharing a path collapsed into one and the second appeared to have **no commands**. Had also been dropping one claim on `GET /api/users` for months | Walking `docs/adding-an-app.md` |
| 6 | `app-boundary-probe.sql` check (2) | **Commented out** — no second schema existed when it was written. *A commented-out probe reports success.* Its first live version then picked `neon_auth.invitation`, a correct refusal of the wrong thing | Creating a second app schema |
| 7 | `pg_dump --schema=issues` as an extraction | Emits the triggers and FKs; all fail at restore; `psql` prints 27 errors and **exits 0**. The database boots, serves, and has silently lost referential integrity and all blob-index maintenance | Actually restoring the dump |
| 8 | `TestRemovedSpellingsStillCarryAHint` | Asserted a **hand-written** cobra error string. The real one contains the whole remaining argv, so the three most-used spellings fell through to the generic hint | Running the built binary |

**#8 was written by the same session that wrote this rule, an hour after writing
it.** That is the point. The rule is not "other people's checks rot" — it is that
you cannot tell by looking, including at your own.

Two corollaries, different mechanisms, both worth stating:

- **A skipped or commented-out check reports success.** If a check cannot run
  yet, make it skip **loudly** — `RAISE NOTICE`, `t.Logf`, a failing assertion on
  its own inputs.
- **Assert your inputs.** Every "did we find anything to check?" assertion here
  exists because a guard that found nothing would otherwise pass. #5 was caught
  by exactly such an assertion.

---

## The four places the plan was wrong

The plan was written before the work. Four of its instructions did not survive
contact, and each correction is now in the document rather than in someone's
memory.

1. **"`blob_references` is exactly the `platform.entities` pattern — same risk,
   same mitigation."** The risk is *not* the same. Entities drift costs a stale
   search result; blob-reference drift in the *missing* direction costs a file
   that is still in use, deleted, with no undo. Symmetric-looking projections,
   wildly asymmetric failure. The index is maintained by **Postgres triggers**
   rather than application writes, so no write path can forget it.
2. **§4.6: reshape `workspace_counters` to `(workspace_id, app, entity_type,
   last_seq)` so apps can share it.** Sharing a counter buys nothing — no query
   ever spans two apps' counters — and costs a shared write point and a shared
   migration per entity type. Migration `0040` **moved** the table to
   `issues.workspace_counters` instead. Generalised: *before reshaping a shared
   table so more apps can use it, ask whether they should be sharing it at all.*
3. **§4.3: per-schema isolation "keeps `pg_dump --schema=sales` a working
   extraction path from day one."** It does not — see finding #7.
4. **§11's extraction bullet named the wrong command.** Corrected to
   `platform` + the app's schema + `drizzle`, with `docs/extracting-an-app.md`
   carrying the procedure and the numbers.

A fifth, from Phase 6, was already recorded: *deploy-first ordering means
`postbuild` owns the migration, so `RUN_MIGRATIONS` must be removed first.*

---

## What is still owed

Nothing is broken. These are known, written down, and deliberately not done.

| Owed | Why it was left | Who should close it |
|---|---|---|
| **`docs/adding-an-app.md` steps 7–10** (changelog file, Vercel project, subdomain, app docs) are **UNVERIFIED** | They need a Vercel project, subdomain and DNS for an app that must never be deployed | Whoever ships the first real app. The document has a box with a line to sign |
| **`CLI_MIN_VERSION` is still `1.9.1`** | Raising it strands every user with nothing to upgrade to. It must follow adoption, not lead it | Target `1.10.0`, a few days after `1.12.0`, **as its own change with nothing else in it** |
| **The session cookie is still per-host, not `.blackcode.ch`** | Moving it signs everyone out once. Deferred since Phase 4 | Schedule at a quiet hour with a changelog notice, *before* a second app needs shared sign-in |
| **`platform.transaction_log` still exists, empty** | Dropping a table is destructive and was not needed. `bk undo` and its routes are gone | Drop it whenever convenient. Do **not** wire a new writer — build undo on `platform.events` if it is ever wanted |
| **`/api/undo` and `/api/openapi.json` 410 stubs** | Installed binaries still call them | Delete when `CLI_MIN_VERSION` passes `1.12.0` |
| **Extraction owes more than the database** | Blob storage (pre-Phase-7 files sit unprefixed at the store root), vendoring `packages/platform-*`, and `platform.users` containing every user of every app | Whoever does a real extraction. The data-protection question is theirs, and this repo deliberately does not answer it |
| **`apiHandler` / `resolveWorkspace` are duplicated in the scaffold** | Both close over the app's `db`, schema and slug; genericising them for a scaffold is speculative | The second **real** app — at which point two production apps need them unchanged, which is the test |

---

## What the next person needs to know

**Read these three files before touching anything near them.** Each exists
because something went wrong once, and each header explains what:

- `packages/platform-storage/src/references.ts` — the delete gate. The only
  thing between a code change and unrecoverable data loss.
- `packages/platform-db/src/schema.ts` at `blobReferences` — why the index is
  trigger-maintained, and why that is not an implementation detail.
- `apps/issues/lib/db/queries/entities.ts` — why the projection is written in
  the source transaction.

**Four operational rules learned the hard way:**

1. **A health check proves the server is up; only the client your users run
   proves the contract still holds.** `/api/status` was green throughout the
   Phase 7 outage, and again when `/api/undo` was handing installed binaries 2KB
   of HTML. Step 4b of the cutover — the real binary against the staged build —
   found both.
2. **The new server must be backwards compatible with the old clients that are
   still installed.** A client cannot be asked to know a convention that shipped
   after it did. This is why trash refs changed *field name* (`id` → `number`)
   rather than *meaning*: redefining `id` would have made every installed binary
   act on a different row — and on `purge`, destroy it.
3. **Removing a route is not finished when the route is gone.** It is finished
   when the old client that still calls it gets an actionable answer. A 410 with
   a `suggestion` is recoverable inside the same run; a 404 is a dead end.
4. **Rehearse on a branch, including the rollback.** Every phase did. It caught a
   real bug in most of them, including a query that would have failed at runtime
   the first time it ran.

**And the one that generalises furthest:** the migration's most valuable output
was not the architecture. It was the eight moments where something that looked
like protection turned out not to be. Assume the next one exists, and go looking
for it the same way — by breaking the thing the check is supposed to catch.
