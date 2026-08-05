-- Phase 8: the CONTRACT half of expand → migrate → contract for `app`.
--
-- `platform.events.app` (0035) and `platform.uploads.app` (0036) both shipped
-- NULLABLE, and both for the same reason: the migration lands BEFORE the deploy
-- that writes the column, so for the length of that window the old code is still
-- inserting rows that do not know it exists. NOT NULL then would have failed
-- every one of those inserts; a DEFAULT would have hardcoded one app's name into
-- a platform table. This is the step that closes it.
--
-- ---------------------------------------------------------------------------
-- THE PRECONDITION, VERIFIED RATHER THAN ASSUMED
-- ---------------------------------------------------------------------------
-- "No deployed code can write a NULL" is not the same claim as "there are no
-- NULLs today", and only the first one makes this safe. Both were checked
-- against production on 2026-08-05:
--
--   DATA      events   3,630 rows, 0 with app IS NULL
--             uploads    105 rows, 0 with app IS NULL
--
--   CODE      `recordEvent` sets `app: APP_SLUG` centrally, not at the ~40 call
--             sites, so no call site can omit it.
--             `recordUpload` is an app-level wrapper that injects APP_SLUG and
--             whose parameter type does not accept `app` at all — a caller
--             cannot pass NULL even deliberately. Both upload paths (multipart
--             and the client-direct blob handshake) go through it.
--
-- The guard below re-checks the data at apply time and ABORTS with a readable
-- message rather than letting `SET NOT NULL` fail with "column contains null
-- values" and no indication of which table or how many.
--
-- ---------------------------------------------------------------------------
-- ORDERING — THIS ONE IS SAFE EITHER SIDE OF THE DEPLOY
-- ---------------------------------------------------------------------------
-- Unlike most contract migrations, this does not have to wait for the code
-- cutover: the code that satisfies it is ALREADY in production (Phases 6 and 7).
-- Applying it before the deploy is therefore fine, and applying it after is fine
-- too. What it must never do is precede a ROLLBACK to a pre-Phase-6 build —
-- that code inserts events with no `app` and would fail on every write. If you
-- roll the deployment back that far, run
-- docs/sql/phase8-app-not-null-rollback.sql first.
--
-- Re-runnable: `SET NOT NULL` on an already-NOT NULL column is a no-op.

DO $guard$
DECLARE
  n_events  bigint;
  n_uploads bigint;
BEGIN
  SELECT count(*) INTO n_events  FROM platform.events  WHERE app IS NULL;
  SELECT count(*) INTO n_uploads FROM platform.uploads WHERE app IS NULL;
  IF n_events > 0 OR n_uploads > 0 THEN
    RAISE EXCEPTION
      'refusing to tighten app to NOT NULL: % event row(s) and % upload row(s) still have a NULL app. Backfill them first (see migrations 0035 and 0036), and find out what wrote them — current code cannot.',
      n_events, n_uploads;
  END IF;
END
$guard$;--> statement-breakpoint

ALTER TABLE "platform"."events" ALTER COLUMN "app" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."uploads" ALTER COLUMN "app" SET NOT NULL;
