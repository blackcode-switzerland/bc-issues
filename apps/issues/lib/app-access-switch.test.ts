// The kill switch, tested without a database.
//
// This is the one piece of Phase 4 that must be right in every environment,
// including ones with no Postgres to talk to: it decides whether enforcement is
// on. The integration tests in lib/db/queries/app-access.integration.test.ts
// cover the behaviour it gates, but they SKIP without TEST_DATABASE_URL — so if
// this file did not exist, `npm test` on a machine with no database would report
// green while checking nothing about access at all.
//
// The direction is the point. Enforcement is ON when the variable is unset,
// because opt-in would mean the intended behaviour depended on remembering to set
// something in every environment — and the environment where you forget is the one
// that quietly stops checking. Recovery is one variable to ADD.

import { describe, expect, it, afterEach } from 'vitest'
import { isAppAccessEnforced } from '@blackcode/platform-auth'

const KEY = 'PLATFORM_ENFORCE_APP_ACCESS'

function withEnv(value: string | undefined): boolean {
  if (value === undefined) delete process.env[KEY]
  else process.env[KEY] = value
  return isAppAccessEnforced()
}

describe('PLATFORM_ENFORCE_APP_ACCESS', () => {
  const original = process.env[KEY]
  afterEach(() => {
    if (original === undefined) delete process.env[KEY]
    else process.env[KEY] = original
  })

  it('enforces when unset — the safe direction needs no configuration', () => {
    expect(withEnv(undefined)).toBe(true)
  })

  it('enforces for any affirmative value', () => {
    for (const v of ['1', 'true', 'yes', 'on', 'enforce', 'ENABLED']) {
      expect(withEnv(v), `${KEY}=${v} should enforce`).toBe(true)
    }
  })

  it('switches off only for explicit opt-out values', () => {
    // The same vocabulary scripts/migrate-if-enabled.mjs uses, so `=0` in a
    // dashboard means what it looks like in both places.
    for (const v of ['0', 'false', 'no', 'off', '', ' OFF ', 'False']) {
      expect(withEnv(v), `${KEY}=${JSON.stringify(v)} should switch enforcement off`).toBe(false)
    }
  })

  it('is read per call, not cached at import', () => {
    // A serverless instance must pick up a changed variable on its next cold
    // start, and a test must be able to flip it without resetting the module
    // cache. Caching it in a module-level const would break both.
    expect(withEnv('0')).toBe(false)
    expect(withEnv('1')).toBe(true)
  })
})
