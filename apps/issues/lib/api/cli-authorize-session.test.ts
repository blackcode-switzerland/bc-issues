// `bk login` must not complete from a session a password reset invalidated.
//
// ---------------------------------------------------------------------------
// THE SAME BUG AS D-24, IN THE OTHER ROUTE THAT MINTS A TOKEN
// ---------------------------------------------------------------------------
// D-24 (2026-08-06) removed a bare `getServerSession` + `getUserByEmail` from
// `/api/tokens`, because that pair accepts a session belonging to a soft-deleted
// user and a session issued BEFORE the account's last password reset — so a
// stale session could still mint a permanent `bk_live_…` credential, and
// revoking the session did not revoke what it minted.
//
// `/api/cli/authorize` mints a token too, and it still had the identical check.
// It was found while extracting the route into a shared factory (Phase 1b-C) and
// fixed on its own, because a refactor that also changes who can do something is
// a refactor whose blast radius nobody can bound.
//
// ---------------------------------------------------------------------------
// BOTH DIRECTIONS, OR IT PROVES NOTHING
// ---------------------------------------------------------------------------
// "The stale session gets a 401" is satisfied just as well by a fixture that
// never authenticated at all — a typo'd email, a mock returning undefined, a
// route that 500s. So the same stale session is run against the OLD resolver
// too, and it must succeed there.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/unused'
  process.env.PLATFORM_DB_DRIVER = 'pg'
})

const RESET_AT = new Date('2026-08-01T10:00:00Z')

const USER = {
  id: 7,
  email: 'compromised@example.test',
  name: 'Test',
  deleted_at: null as Date | null,
  password_changed_at: RESET_AT,
}

/** The session cookie an attacker still holds — issued BEFORE the reset. */
const STALE_SESSION = { user: { email: USER.email, pwStamp: 0 } }
/** A session issued after the reset, whose stamp matches. */
const FRESH_SESSION = { user: { email: USER.email, pwStamp: RESET_AT.getTime() } }

const getServerSession = vi.hoisted(() => vi.fn())
vi.mock('next-auth', () => ({ getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/db/queries/users', () => ({
  getUserByEmail: async (email: string) => (email === USER.email ? USER : null),
}))

/**
 * Minting is the thing this route does; the token itself is not under test.
 *
 * Stubbed at `@blackcode/platform-auth`, which is where the shared factory
 * imports it from — the rest of the package stays real, because
 * `getValidatedSessionUser` is not what this file is allowed to fake.
 */
const minted = vi.hoisted(() => [] as Array<{ user_id: number; name: string }>)
vi.mock('@blackcode/platform-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@blackcode/platform-auth')>()),
  mintToken: async (_db: unknown, opts: { user_id: number; name: string }) => {
    minted.push(opts)
    return { id: 1, plaintext: 'bk_live_test', name: opts.name }
  },
}))

import { POST } from '@/app/api/cli/authorize/route'

function authorizeRequest(): NextRequest {
  return new NextRequest('https://issues.blackcode.test/api/cli/authorize', {
    method: 'POST',
    body: JSON.stringify({
      callback: 'http://127.0.0.1:9999/callback',
      state: 'abc123',
      name: 'cli-test',
    }),
  })
}

describe('/api/cli/authorize rejects sessions a password reset invalidated', () => {
  beforeEach(() => {
    getServerSession.mockReset()
    minted.length = 0
  })

  // THE PREMISE. The old check was `getServerSession` + `getUserByEmail`, which
  // is exactly what this fixture satisfies: a session with an email that
  // resolves to a real user. If this did not hold, the 401 below would be
  // evidence of a broken fixture rather than of the fix.
  it('THE PREMISE: the fixture authenticates under the OLD check', async () => {
    getServerSession.mockResolvedValue(STALE_SESSION)
    const session = (await getServerSession({})) as typeof STALE_SESSION | null
    const { getUserByEmail } = await import('@/lib/db/queries/users')
    expect(session?.user?.email).toBe(USER.email)
    expect(
      await getUserByEmail(session!.user.email),
      'the old check resolved this stale session to a user, and would have minted'
    ).not.toBeNull()
  })

  it('a stale session cannot complete bk login', async () => {
    getServerSession.mockResolvedValue(STALE_SESSION)
    const res = await POST(authorizeRequest())
    expect(res.status).toBe(401)
    expect(
      minted,
      'a token was minted for a session that a password reset had already ' +
        'invalidated — revoking that session would not revoke this credential'
    ).toHaveLength(0)
  })

  it('a session issued after the reset still works', async () => {
    getServerSession.mockResolvedValue(FRESH_SESSION)
    const res = await POST(authorizeRequest())
    expect(
      res.status,
      'the fix must not break bk login — a check that rejects everything is not a check'
    ).toBe(200)
    expect(minted).toHaveLength(1)
    expect((await res.json()).redirect_url).toContain('token=bk_live_test')
  })

  it('a soft-deleted user holding a valid-looking session is rejected', async () => {
    getServerSession.mockResolvedValue(FRESH_SESSION)
    USER.deleted_at = new Date()
    try {
      const res = await POST(authorizeRequest())
      expect(res.status).toBe(401)
      expect(minted).toHaveLength(0)
    } finally {
      USER.deleted_at = null
    }
  })
})
