// Integration tests for app-aware reference counting (Phase 7). These hit a real
// Postgres, so they only run when TEST_DATABASE_URL is set (pointed at a
// throwaway/test DB with the migrations applied). They never touch DATABASE_URL.
//
//   TEST_DATABASE_URL=postgres://… npm test
//
// ---------------------------------------------------------------------------
// WHY THESE EXIST
// ---------------------------------------------------------------------------
// The unit tests in registry.test.ts prove the registry's LOGIC with fake
// scanners and a fake db. They cannot prove the thing that actually protects
// production: that the real scanner, running the real SQL against the real
// schema, still finds a real reference. A registry that is perfectly fail-closed
// but whose scanner silently matches nothing would pass every unit test and
// delete every file in the workspace.
//
// So the assertions here are of two kinds, and both are needed:
//
//   1. THE POSITIVE — a url that a live row references is reported as
//      referenced. This is the assertion that stands between the GC and the
//      data. It is checked against a url read out of the database, not one this
//      test wrote, so it exercises the same shape production stores.
//   2. THE NEGATIVE — a url nothing references is reported as unreferenced.
//      Without it, a scanner stuck at `true` would look "safe" while making
//      cleanup impossible, and every test above would still pass.
//
// NOTHING HERE DELETES ANYTHING. The GC is not exercised against a real store on
// purpose: the only safe production delete is one you can point at a file you
// uploaded yourself.

import { beforeAll, describe, expect, it } from 'vitest'

const TEST_DB = process.env.TEST_DATABASE_URL
// Point the db client at the test DB before it is imported.
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = TEST_DB ? describe : describe.skip

run('app-aware reference counting (integration)', () => {
  let storage: typeof import('./index')
  let registeredScannerApps: typeof import('@blackcode/platform-storage')['registeredScannerApps']

  beforeAll(async () => {
    storage = await import('./index')
    ;({ registeredScannerApps } = await import('@blackcode/platform-storage'))
  })

  it('registers this app before any reference question is asked', () => {
    expect(registeredScannerApps()).toContain('issues')
  })

  it('reports a url that a live row references as REFERENCED', async () => {
    const { db } = await import('../db/client')
    const { sql } = await import('drizzle-orm')

    // A url taken from a real description — the exact shape production stores.
    const res = await db.execute(sql`
      SELECT description FROM issues.issues
       WHERE description LIKE '%blob.vercel-storage.com%' OR description LIKE '%/uploads/%'
       LIMIT 1
    `)
    const body = (res.rows[0] as { description?: string } | undefined)?.description
    if (!body) {
      console.warn('[phase7] no embedded upload found in this database — positive case skipped')
      return
    }
    const [url] = storage.extractUploadedUrls(body)
    expect(url).toBeTruthy()
    expect(await storage.isUrlReferencedAnywhere(url)).toBe(true)
  })

  it('reports a url nothing references as UNREFERENCED', async () => {
    const orphan = 'https://never-stored.public.blob.vercel-storage.com/issues/x/phase7-not-real.png'
    expect(await storage.isUrlReferencedAnywhere(orphan)).toBe(false)
  })

  it('treats an unknown url as referenced (fail safe)', async () => {
    expect(await storage.isUrlReferencedAnywhere('')).toBe(true)
  })
})
