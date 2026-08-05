// Integration tests for `bk_live_` API tokens. Needs a real Postgres, so they
// only run with TEST_DATABASE_URL set; they never touch DATABASE_URL.
//
//   TEST_DATABASE_URL=postgres://… PLATFORM_DB_DRIVER=pg npm test
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------------
// It was written FOR the Phase 6 move of token minting/verification into
// @blackcode/platform-auth. The move was not a copy: the package takes the
// database handle as a parameter and uses raw schema-qualified SQL rather than
// the Drizzle query builder, because its functions must accept both a `db` and a
// transaction handle and the two builders do not share a type.
//
// That is a rewrite of the code path that authenticates every single CLI request,
// and it had NO test coverage before. Moving credential-verification code on the
// strength of it looking equivalent is exactly how an auth bug ships quietly: a
// broken expiry check does not throw, it just accepts a token it should refuse.
//
// So the cases below are the ones where being wrong is dangerous rather than
// merely inconvenient — an expired token, a revoked token, another user's token,
// a token with the wrong prefix — and each asserts a refusal, not an absence of
// errors.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = TEST_DB ? describe : describe.skip

run('bk_live_ API tokens (integration)', () => {
  let db: typeof import('@/lib/db/client')['db']
  let schema: typeof import('@/lib/db/schema')
  let tokens: typeof import('./tokens')
  let eq: typeof import('drizzle-orm')['eq']

  let userId: number
  let otherUserId: number
  let suffix: string

  beforeAll(async () => {
    db = (await import('@/lib/db/client')).db
    schema = await import('@/lib/db/schema')
    tokens = await import('./tokens')
    eq = (await import('drizzle-orm')).eq

    suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    const [u] = await db
      .insert(schema.users)
      .values({ email: `tokens_${suffix}@test.local`, name: 'Token Owner' })
      .returning({ id: schema.users.id })
    userId = u.id
    const [o] = await db
      .insert(schema.users)
      .values({ email: `tokens_other_${suffix}@test.local`, name: 'Other' })
      .returning({ id: schema.users.id })
    otherUserId = o.id
  })

  afterAll(async () => {
    if (userId) await db.delete(schema.users).where(eq(schema.users.id, userId))
    if (otherUserId) await db.delete(schema.users).where(eq(schema.users.id, otherUserId))
  })

  it('mints a token that verifies back to its owner', async () => {
    const minted = await tokens.mintToken({ user_id: userId, name: `ci-${suffix}` })

    expect(minted.plaintext.startsWith('bk_live_')).toBe(true)
    expect(minted.name).toBe(`ci-${suffix}`)
    expect(minted.scopes).toEqual(['full'])
    expect(minted.id).toBeGreaterThan(0)

    const user = await tokens.verifyToken(minted.plaintext)
    expect(user, 'a freshly minted token must resolve to its owner').not.toBeNull()
    expect(user!.id).toBe(userId)
    // Every field the resolver downstream relies on must survive the raw-SQL
    // round trip, not just the id.
    expect(user!.email).toBe(`tokens_${suffix}@test.local`)
    expect(user!.deleted_at).toBeNull()
  })

  it('stores only a hash — the plaintext is never recoverable', async () => {
    const minted = await tokens.mintToken({ user_id: userId, name: `hash-${suffix}` })
    const rows = await db
      .select()
      .from(schema.apiTokens)
      .where(eq(schema.apiTokens.id, minted.id))
    expect(rows[0].token_hash).not.toBe(minted.plaintext)
    expect(rows[0].token_hash).toHaveLength(64) // sha256 hex
    expect(minted.plaintext).toContain(rows[0].token_prefix)
  })

  it('records last_used_at on a successful verify', async () => {
    const minted = await tokens.mintToken({ user_id: userId, name: `used-${suffix}` })
    const before = await db
      .select()
      .from(schema.apiTokens)
      .where(eq(schema.apiTokens.id, minted.id))
    expect(before[0].last_used_at).toBeNull()

    await tokens.verifyToken(minted.plaintext)

    const after = await db
      .select()
      .from(schema.apiTokens)
      .where(eq(schema.apiTokens.id, minted.id))
    expect(after[0].last_used_at).not.toBeNull()
  })

  it('honours a custom scope list', async () => {
    const minted = await tokens.mintToken({
      user_id: userId,
      name: `scoped-${suffix}`,
      scopes: ['read', 'write'],
    })
    expect(minted.scopes).toEqual(['read', 'write'])
    const listed = await tokens.listTokens(userId)
    expect(listed.find((t) => t.id === minted.id)?.scopes).toEqual(['read', 'write'])
  })

  // ---- the refusals ----

  it('REFUSES an expired token', async () => {
    const minted = await tokens.mintToken({
      user_id: userId,
      name: `expired-${suffix}`,
      expires_at: new Date(Date.now() - 60_000),
    })
    expect(await tokens.verifyToken(minted.plaintext)).toBeNull()
  })

  it('accepts a token whose expiry is still in the future', async () => {
    const minted = await tokens.mintToken({
      user_id: userId,
      name: `future-${suffix}`,
      expires_at: new Date(Date.now() + 3_600_000),
    })
    expect(await tokens.verifyToken(minted.plaintext)).not.toBeNull()
  })

  it('REFUSES a revoked token, and revoke is scoped to the owner', async () => {
    const minted = await tokens.mintToken({ user_id: userId, name: `revoke-${suffix}` })

    // Another user knowing the id must not be able to revoke it.
    expect(await tokens.revokeToken(minted.id, otherUserId)).toBe(false)
    expect(await tokens.verifyToken(minted.plaintext)).not.toBeNull()

    expect(await tokens.revokeToken(minted.id, userId)).toBe(true)
    expect(await tokens.verifyToken(minted.plaintext)).toBeNull()
    // Revoking twice is false, not an error.
    expect(await tokens.revokeToken(minted.id, userId)).toBe(false)
  })

  it('REFUSES garbage, the wrong prefix, and a near-miss of a real token', async () => {
    const minted = await tokens.mintToken({ user_id: userId, name: `nearmiss-${suffix}` })

    expect(await tokens.verifyToken('')).toBeNull()
    expect(await tokens.verifyToken('not-a-token')).toBeNull()
    // Right shape, wrong prefix — the prefix check must reject before any lookup.
    expect(await tokens.verifyToken(minted.plaintext.replace('bk_live_', 'bk_test_'))).toBeNull()
    // One character off the real secret.
    const nearMiss = minted.plaintext.slice(0, -1) + (minted.plaintext.endsWith('a') ? 'b' : 'a')
    expect(await tokens.verifyToken(nearMiss)).toBeNull()
  })

  it('lists only the caller-owned tokens, newest first', async () => {
    const mine = await tokens.mintToken({ user_id: userId, name: `list-${suffix}` })
    const theirs = await tokens.mintToken({ user_id: otherUserId, name: `theirs-${suffix}` })

    const listed = await tokens.listTokens(userId)
    const ids = listed.map((t) => t.id)
    expect(ids).toContain(mine.id)
    expect(ids, "another user's token must never appear").not.toContain(theirs.id)
    // Newest first, and no plaintext anywhere in the listing.
    expect(listed[0].id).toBe(mine.id)
    expect(JSON.stringify(listed)).not.toContain('bk_live_')
  })
})
