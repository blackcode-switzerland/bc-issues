# The platform database

One Postgres database, one Neon project, one schema per app plus `platform`.
This file is about the **boundary** — who may read what, and the SQL that
establishes it. For what the tables mean, see [`backend.md`](backend.md); for one
app's own tables, see that app's `docs/backend.md`.

> Promised by Phase 3 step 7 and written in Phase 8. Until then the role SQL
> lived in `docs/sql/app-role.sql` with nothing pointing at it, and
> `docs/adding-an-app.md` referenced a file that did not exist.

## The shape

```
neondb
├── platform.*     what every app shares — identity, workspaces, membership,
│                  per-app access, comments, labels, uploads, events, entities,
│                  links, blob_references
├── issues.*       the issue tracker's own tables
└── template.*     the scaffold's (apps/_template)
```

**The rule, in one line:** an app may read and write `platform.*` and its own
schema. Nothing else. It is enforced by **grants**, not by review — `issues_app`
simply has no `SELECT` on `template.*`.

An app may FK into `platform.*` freely. **`platform` may never FK into an app**:
that direction would make `pg_dump --schema=issues` produce something that
cannot be restored, which is the extraction path §11 of
platform-architecture.md is built on. Migration 0032 dropped the last one.

## Two credentials, and why

| Var | Role | Used by | Rights |
|---|---|---|---|
| `DATABASE_URL` | `<app>_app` | the app at runtime | DML only. Owns nothing |
| `MIGRATE_DATABASE_URL` | `neondb_owner` | `drizzle-kit migrate`, `postbuild` | owns both schemas |

**The app role must not own the tables.** Ownership is what confers DDL: an owner
can `ALTER` or `DROP`, including tables in `platform` that every other app
depends on. Splitting "the role that migrates" from "the role the app runs as"
is what stops one app silently reshaping shared schema.

Neon's built-in `neondb_owner` is the migrator rather than a third minted role —
it already owns everything, and a separate owner would be another credential to
rotate for no additional guarantee. What the rule actually requires is that the
APP role owns nothing, and `docs/sql/app-role.sql` asserts exactly that.

Keep the fallback to `DATABASE_URL` when `MIGRATE_DATABASE_URL` is unset, so
local dev needs one variable. Every future app repeats this pair.

## Creating an app's role

`docs/sql/app-role.sql` is the script. Run it as `neondb_owner`, substituting the
app slug and a generated password. It does seven things, and step 5b is the one
that is easy to skip:

1. `CREATE ROLE <app>_app LOGIN`
2. `GRANT USAGE` on `platform` and `<app>` — reaching the schemas grants nothing
   inside them
3. `GRANT SELECT, INSERT, UPDATE, DELETE` on all tables. **No `TRUNCATE`, no
   `REFERENCES`, no `TRIGGER`**
4. `GRANT USAGE, SELECT` on all sequences — easy to forget, and the failure is
   confusing: every insert into a `serial` table fails with "permission denied
   for sequence" despite the `INSERT` grant
5. `ALTER DEFAULT PRIVILEGES` so the next migration's tables are readable
6. **5b. Revoke write on `platform.blob_references`, leaving `SELECT`.** Step 5
   hands every future platform table full DML; that is wrong for exactly one
   table. A role with `DELETE` on the blob index could erase another app's
   references, after which a delete that should have been refused proceeds and
   the bytes are gone
7. `ALTER ROLE … SET search_path`, and `REVOKE ALL ON SCHEMA drizzle` so a stray
   `drizzle-kit migrate` with app credentials fails loudly instead of
   half-applying

## Then prove it

```bash
psql "postgres://<app>_app:<pw>@<host>/<db>" -f docs/sql/app-boundary-probe.sql
```

**Run it as the app role. `SET ROLE` from the owner is not a substitute** and
gives the wrong answer: `session_user` ignores `SET ROLE`, and inside a
`SECURITY DEFINER` function `current_user` is the function's owner rather than
the caller.

That is not a hypothetical. `platform.blob_refs_purge` shipped in 0037 guarding
on `current_user`, which made the guard true for everybody — any app could purge
any other app's blob references. It was found by running the probe as the real
role and fixed in 0038. Every deny in the probe must be `42501`.

## Triggers: the one thing an app must install

`platform.blob_references` is maintained by **Postgres triggers on each app's
content tables**, not by application code, so that no write path can forget it.
See `packages/platform-db/src/schema.ts` at `blobReferences` for why, and
migration `0037` for the shape.

If your app's content can hold an uploaded file URL — a description, a body, a
comment, an attachment row — it needs a trigger per content column, and it must
set `platform.apps.maintains_blob_index = true` **in the same migration, after
the backfill**. Setting the flag before the index is built advertises an empty
index as authoritative, which is how a file still in use gets deleted.

Until it does, blob deletion in **every** deployment refuses — correctly, because
nobody can prove the file is unused. That is not a bug to work around.

## Counters live in the app, not in platform

An app's `#number` sequence is app data. Keep the counter table in your own
schema; do not add a column to a shared one. `apps/_template` does it in three
lines, and migration `0040` moved `workspace_counters` out of `platform` for
exactly this reason — see platform-architecture.md §4.6.

Allocate with `UPDATE … RETURNING` inside the same transaction as the row
insert, never read-then-write: two concurrent creates would otherwise read the
same value and collide.

## Migrations

Drizzle, in the app that owns the schema. `apps/issues/lib/db/migrations/` holds
the platform migrations too, because `issues` was the first app and the ledger
cannot be split retroactively — a second app's migrations go in its own
directory against its own schema.

- **Rehearse on a Neon branch first**, including the rollback. Every phase of
  this migration did, and it caught a real bug in three of them.
- **Expand → migrate → contract** for anything a running deployment reads. Add
  nullable, backfill, tighten in a later release once no deployed code can write
  the old shape — and verify that in the CODE, not just in the data.
- A migration that breaks running code (`SET SCHEMA`, a rename, a `NOT NULL` the
  current build violates) is **migrate-first**: chain the migration and the
  promote with `&&` so the promote fires the instant the migration succeeds and
  not at all if it fails.
- `RUN_MIGRATIONS=1` makes `postbuild` migrate during a production build. For a
  deploy-first ordering it **must be removed first**, or the build applies your
  migration before you have gated it.

## Assertions worth re-running

```sql
-- (a) The app role owns nothing.
SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
WHERE r.rolname = '<app>_app';

-- (b) It holds no DDL-implying privilege anywhere.
SELECT table_schema, table_name, privilege_type
FROM information_schema.table_privileges
WHERE grantee = '<app>_app'
  AND privilege_type NOT IN ('SELECT','INSERT','UPDATE','DELETE');

-- (c) It cannot write the blob index.
SELECT grantee, privilege_type FROM information_schema.table_privileges
WHERE table_schema='platform' AND table_name='blob_references';
```

Both (a) and (b) must return zero rows; (c) must show `SELECT` and nothing else
for every `*_app` role.
