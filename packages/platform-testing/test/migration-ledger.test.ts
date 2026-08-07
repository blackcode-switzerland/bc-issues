// Every app migrates into its OWN Drizzle ledger.
//
// The mechanism, the reproduction and why this is a test rather than a line in
// docs/adding-an-app.md are all in `src/migration-ledger.ts`. The short version:
// two apps on one ledger means one app's next migration is silently skipped —
// no error, no ledger row, exit 0, and it never self-heals.

import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  appLedgers,
  ledgerCollisions,
  ledgerKey,
  DEFAULT_MIGRATIONS_SCHEMA,
  DEFAULT_MIGRATIONS_TABLE,
} from '../src/migration-ledger'

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')
const APPS_ROOT = join(REPO_ROOT, 'apps')

const LEDGERS = appLedgers(APPS_ROOT)

/**
 * The one app that owns drizzle's DEFAULT ledger, and why it cannot be moved.
 *
 * Same reasoned-allowance shape as `app-isolation.test.ts`'s scanner allowlist —
 * one pattern in this repo, not two — including the staleness check below.
 *
 * **`apps/issues` MUST keep `drizzle.__drizzle_migrations`.** Renaming it would
 * point the migrator at an empty table, which reads as "no migration has ever
 * run", and it would re-apply all forty-three from `0000` against a live
 * production database. The default is not a decision issues made; it is a
 * decision it can no longer unmake. So the default belongs to issues, and every
 * app added afterwards declares its own.
 */
const OWNS_DEFAULT_LEDGER = {
  app: 'issues',
  reason:
    'Renaming it would make drizzle believe no migration has ever run and re-apply ' +
    'all 43 against production. The default is not a choice issues made; it is one ' +
    'it can no longer unmake.',
}

describe('the inputs — assert these first, or the check below is theatre', () => {
  // A scan that found no configs finds no collisions and reports a confident
  // green. CLAUDE.md names this as a corollary of the standing rule.
  it('found app drizzle configs', () => {
    expect(
      LEDGERS.map((l) => l.config),
      `no drizzle config found under ${APPS_ROOT}. Either the config filename changed, ` +
        'or APPS_ROOT is wrong — both of which make every assertion below pass by ' +
        'checking nothing.'
    ).not.toEqual([])
  })

  it('found more than one, or there is nothing to collide', () => {
    // With a single app the collision check is vacuously true. That state is
    // legitimate (it was true until 2026-08-07) but it must be VISIBLE, not
    // silently reported as a pass.
    expect(
      LEDGERS.length,
      'only one app has a drizzle config, so nothing can collide yet. This is not a ' +
        'failure of the code — it is this test telling you it is currently proving ' +
        'nothing. Delete this case deliberately if the platform ever goes back to one app.'
    ).toBeGreaterThan(1)
  })

  it('every app with migrations on disk has a config this can read', () => {
    // The dangerous gap: an app that migrates but whose config this file cannot
    // parse would be absent from LEDGERS entirely and could not collide with
    // anything. Being absent must not be a way to pass.
    const migrating = readdirSync(APPS_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .filter((e) => existsSync(join(APPS_ROOT, e.name, 'lib', 'db', 'migrations')))
      .map((e) => e.name)
    const covered = new Set(LEDGERS.map((l) => l.dir))
    expect(
      migrating.filter((d) => !covered.has(d)),
      'these apps have lib/db/migrations/ but no drizzle config this test could find. ' +
        'They migrate into a ledger nothing here checks.'
    ).toEqual([])
  })

  it('no config declares a migrations block this cannot read', () => {
    // Never guessed around: assuming the default for an unreadable declaration
    // could hide a real collision, which is the one thing this must not do.
    expect(
      LEDGERS.filter((l) => l.unreadable).map((l) => `${l.config}: ${l.unreadable}`),
      'this test reads the config as TEXT (importing it needs DATABASE_URL and throws ' +
        'without one), so a computed table name is unreadable rather than absent. ' +
        'Use a plain string literal, or teach src/migration-ledger.ts to read this shape.'
    ).toEqual([])
  })
})

describe('every app has its own drizzle migration ledger', () => {
  it('no two apps share one', () => {
    const collisions = [...ledgerCollisions(LEDGERS)].map(
      ([key, apps]) => `${key} <- ${apps.map((a) => a.config).join(' AND ')}`
    )
    expect(
      collisions,
      'two apps would migrate into the SAME drizzle ledger, and this database is ' +
        'shared by every app. Drizzle applies a migration only when its timestamp is ' +
        'newer than the single latest row in that table, with no notion of which app ' +
        'wrote it — so whichever app migrates last raises the mark for both, and the ' +
        "other app's next migration is SILENTLY SKIPPED: no error, no row, exit 0, " +
        'and it never self-heals. Give the newer app its own:\n\n' +
        "    migrations: { table: '__drizzle_migrations_<app>', schema: 'drizzle' }\n\n" +
        'in its drizzle.config.ts. See apps/sales/drizzle.config.ts.\n' +
        collisions.join('\n')
    ).toEqual([])
  })

  it(`only ${OWNS_DEFAULT_LEDGER.app} uses the default ledger`, () => {
    // Distinctness alone already catches a third app keeping the default — it
    // would collide with issues. This case exists so the failure names the RIGHT
    // app to change: without it, somebody "fixes" the collision by renaming
    // issues, which is the one rename that cannot be made.
    const onDefault = LEDGERS.filter(
      (l) => l.schema === DEFAULT_MIGRATIONS_SCHEMA && l.table === DEFAULT_MIGRATIONS_TABLE
    ).map((l) => l.dir)
    expect(
      onDefault,
      `drizzle's default ledger (${DEFAULT_MIGRATIONS_SCHEMA}.${DEFAULT_MIGRATIONS_TABLE}) ` +
        `belongs to apps/${OWNS_DEFAULT_LEDGER.app}. ${OWNS_DEFAULT_LEDGER.reason} ` +
        'Every app added afterwards declares its own — change the NEW app, never this one.'
    ).toEqual([OWNS_DEFAULT_LEDGER.app])
  })

  it('the grandfather clause still describes something real', () => {
    // Staleness, the same rule the scanner's allowlist follows: an allowance
    // that no longer matches anything is a decision still being honoured for a
    // situation that has gone. If issues ever moves off the default, this entry
    // must be deleted rather than left to justify nothing.
    const issues = LEDGERS.find((l) => l.dir === OWNS_DEFAULT_LEDGER.app)
    expect(
      issues && ledgerKey(issues),
      `apps/${OWNS_DEFAULT_LEDGER.app} no longer uses the default ledger, so the ` +
        'grandfather clause above describes nothing. Delete it — a stale allowance ' +
        'reads as a considered decision while suppressing nothing.'
    ).toBe(`${DEFAULT_MIGRATIONS_SCHEMA}.${DEFAULT_MIGRATIONS_TABLE}`)
  })
})
