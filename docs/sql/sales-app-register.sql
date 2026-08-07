-- Register `sales` in `platform.apps` — docs/adding-an-app.md step 3.
--
-- **HUMAN STEP, AND THE ORDER IS LOAD-BEARING.** Run part 1, then the
-- migrations, then part 2. Running them together, or part 2 first, stops blob
-- deletion in every deployment until it is undone.
--
-- ---------------------------------------------------------------------------
-- YOU DO NOT HAVE TO SPLIT THIS FILE. RUN THE WHOLE THING, TWICE.
-- ---------------------------------------------------------------------------
-- "Run part 1" reads like an instruction to select half a file in an editor at
-- an hour when nobody should be doing that. It is not:
--
--     psql … -f docs/sql/sales-app-register.sql     BEFORE the migrations
--     <run the migrations>
--     psql … -f docs/sql/sales-app-register.sql     AFTER them
--
-- Part 2 is an UPDATE guarded on `maintains_blob_index = true`, which only 0002
-- sets — so on the first run it matches nothing and the app stays disabled.
-- Rehearsed 2026-08-07 against a copy of the local database:
--
--     INSERT 0 1
--     UPDATE 0                                      ← part 2, before 0002
--     sales | enabled=f | maintains_blob_index=f
--
-- And part 1's `ON CONFLICT DO UPDATE` touches name, description and base_url
-- only — never `enabled` — so the second run cannot switch the app back off.
-- Both halves are idempotent in both directions. Split it only if you enjoy it.

-- ---------------------------------------------------------------------------
-- PART 1 — BEFORE the sales migrations. `enabled = false`.
-- ---------------------------------------------------------------------------
-- The moment an ENABLED row exists here, every deployment's blob-delete gate
-- starts asking whether `sales` references a file. Until 0002's triggers exist
-- and `maintains_blob_index` is true, nobody can answer — so
-- `assertScannerCoverage` raises `ReferenceCoverageError` and **blob deletion is
-- refused platform-wide, including in `issues`**. That is the gate working
-- exactly as designed, and it is why this row goes in disabled.
--
-- `base_url` IS LOAD-BEARING SINCE CLI 3.0.0 (D-1). It is what `bk login` and
-- `bk meta` learn this app's address from, and the CLI refuses to guess: with
-- the column NULL, every `bk sales …` command fails with "no server known for
-- app sales" on every machine, however correct everything else is. Set it here,
-- not later. `bk app list` is where you check it.
INSERT INTO platform.apps (slug, name, description, base_url, enabled)
VALUES (
  'sales',
  'Sales',
  'blackcode''s business-development pipeline — prospects, meetings, communications',
  'https://sales.blackcode.ch',
  false
)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      base_url = EXCLUDED.base_url;

-- ---------------------------------------------------------------------------
-- NOW RUN THE MIGRATIONS
-- ---------------------------------------------------------------------------
--   0001_sales_init             the schema, counters, tsvector + GIN
--   0002_blob_reference_index   the eleven triggers, the backfill, then
--                               `maintains_blob_index = true`
--
--   Production: `RUN_MIGRATIONS=1` on the sales Vercel project, Production only,
--   so `postbuild` applies them during the build being promoted.
--   By hand:    npm run db:migrate --workspace=sales   (as MIGRATE_DATABASE_URL)
--
-- Confirm before continuing — this must return `t`:
--   SELECT maintains_blob_index FROM platform.apps WHERE slug = 'sales';

-- ---------------------------------------------------------------------------
-- PART 2 — ONLY AFTER 0002 HAS RUN AND THE FLAG IS TRUE.
-- ---------------------------------------------------------------------------
-- Guarded rather than a bare UPDATE: if the flag is false this changes nothing
-- and the app stays invisible, which is recoverable. Enabling an app that cannot
-- answer for its references is the state that ends in a deleted file.
UPDATE platform.apps
SET enabled = true
WHERE slug = 'sales' AND maintains_blob_index = true;

-- Verify. `enabled` and `maintains_blob_index` must BOTH be true:
--   SELECT slug, enabled, maintains_blob_index, base_url FROM platform.apps ORDER BY slug;
--
-- Then, from any machine:  bk app list   -> sales must show its base_url.
-- And the gate, from the issues deployment: deleting an unreferenced blob must
-- succeed again. If it still raises ReferenceCoverageError, part 2 did not take.
