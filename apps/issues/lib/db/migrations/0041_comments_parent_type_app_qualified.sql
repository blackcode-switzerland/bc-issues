-- Phase 1e-1 (D-14): `platform.comments.parent_type` becomes `<app>:<noun>`.
--
-- ---------------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------------
-- `platform.comments` is shared. Its CHECK enumerated ONE app's three nouns
-- ('issue', 'task', 'project'), so a comment on a sales prospect was rejected by
-- the database, and the first time two apps both invented `note` or `report`
-- they would have collided silently in a table neither of them owns.
--
-- Qualification is the part that is genuinely hard to retrofit, which is why it
-- happens now rather than when the second app needs it.
--
-- ---------------------------------------------------------------------------
-- WHY A SHAPE PATTERN AND NOT AN ENUMERATION
-- ---------------------------------------------------------------------------
-- The obvious alternative is to keep listing values and add each app's nouns:
-- 'issues:issue', 'sales:prospect', … That is a hand-maintained duplicate list
-- in the one place that must not have one — `platform` enumerating an app's
-- vocabulary is exactly what `platform.entities.entity_type` refuses to do
-- ("each app owns its own vocabulary here — platform deliberately does not
-- enumerate them", schema.ts) and it would mean a shared-table migration every
-- time any app adds a noun.
--
-- So the CHECK validates the SHAPE, not the vocabulary:
--
--     <app>:<noun>   both halves [a-z][a-z0-9_-]*, each at most 40 chars
--
-- WHAT THIS DOES NOT DO, STATED PLAINLY: it does not verify that <app> is a
-- registered app. `'nonsense:thing'` is well-formed and is ACCEPTED. Validating
-- the app half would need a generated column plus a foreign key to
-- `platform.apps`, and `platform.blob_references` already records why that
-- direction is refused ("No FK to apps.slug … deregistering an app must not
-- silently drop its references"). It would also make `'sales:prospect'` illegal
-- until the sales app row exists, which inverts the ordering this migration is
-- here to unblock.
--
-- What the CHECK DOES reject is the failure that actually happens: a NEW,
-- UNQUALIFIED noun. `'prospect'` is refused. That is the collision D-14 exists
-- to prevent — two apps writing the same bare word into one shared column.
--
-- ---------------------------------------------------------------------------
-- 81 CHARACTERS
-- ---------------------------------------------------------------------------
-- 40 (`platform.apps.slug`) + 1 + 40 (`platform.entities.entity_type`). Not a
-- round number on purpose: it is the composition of the two widths that already
-- exist, so it moves when they move and not before. Widening a varchar is a
-- catalog-only change in Postgres — no table rewrite.
--
-- ---------------------------------------------------------------------------
-- EXPAND + MIGRATE. THE CONTRACT STEP IS NOT HERE.
-- ---------------------------------------------------------------------------
-- The CHECK still accepts the three bare legacy values, and every read path in
-- `apps/issues` matches BOTH forms for one release (see
-- `lib/db/queries/qualified-type.ts`). Dropping the bare branch is a later
-- release, once no deployed build can write it — verified in the CODE, not in
-- the data. Recorded in docs/next-fixes.md under OPEN FOLLOW-UPS.
--
-- ---------------------------------------------------------------------------
-- DEPLOY ORDERING — READ THIS BEFORE APPLYING TO PRODUCTION
-- ---------------------------------------------------------------------------
-- The backfill at the bottom is invisible to the NEW build (it matches both
-- forms) and invisible to any OTHER app (none writes comments today). It is NOT
-- invisible to the OLD build, which matches `parent_type = 'issue'` exactly and
-- would render every comment thread empty until the promote lands.
--
-- No data is lost and it self-heals the moment the new build serves, but the
-- window must be kept to seconds: **chain the migration and the promote**, the
-- same remedy docs/platform-db.md prescribes for a migrate-first cutover. In
-- practice that means leaving `RUN_MIGRATIONS` set so `postbuild` applies this
-- during the build that is about to be promoted — do NOT apply it by hand hours
-- ahead.
--
-- Rollback: docs/sql/phase1e-comments-parent-type-rollback.sql

ALTER TABLE "platform"."comments" DROP CONSTRAINT IF EXISTS "comments_parent_type_check";--> statement-breakpoint

ALTER TABLE "platform"."comments" ALTER COLUMN "parent_type" TYPE varchar(81);--> statement-breakpoint

ALTER TABLE "platform"."comments" ADD CONSTRAINT "comments_parent_type_check" CHECK (
  "parent_type" IS NULL
  -- LEGACY, dropped at the contract step. Exactly the three values that exist
  -- today, so no NEW bare noun can slip in behind them.
  OR "parent_type" IN ('issue', 'task', 'project')
  OR "parent_type" ~ '^[a-z][a-z0-9_-]{0,39}:[a-z][a-z0-9_-]{0,39}$'
);--> statement-breakpoint

-- MIGRATE. Bounded by the same three literals the legacy branch names, so
-- re-running it is a no-op and it can never touch an already-qualified row.
UPDATE "platform"."comments"
   SET "parent_type" = 'issues:' || "parent_type"
 WHERE "parent_type" IN ('issue', 'task', 'project');
