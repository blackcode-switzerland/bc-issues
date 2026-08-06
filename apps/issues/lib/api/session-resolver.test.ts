// /api/tokens must reject a session that a password reset invalidated.
//
// ---------------------------------------------------------------------------
// THE BUG THIS LOCKS DOWN
// ---------------------------------------------------------------------------
// Until 2026-08-06 the token routes authenticated with a bare
// `getServerSession` + `getUserByEmail`, while every other session-authenticated
// path in the app used `getValidatedSessionUser`, which additionally compares
// the session's `pwStamp` against the user's `password_changed_at` and rejects
// soft-deleted users.
//
// So a session issued BEFORE a password reset could still mint a `bk_live_…`
// token afterwards — and revoking that session did not revoke what it minted. A
// password reset is what somebody does when they think their account is
// compromised; one that leaves the attacker able to create a permanent
// credential has not done its job.
//
// ---------------------------------------------------------------------------
// BOTH DIRECTIONS, OR IT PROVES NOTHING
// ---------------------------------------------------------------------------
// "The stale session gets a 401" passes just as well if the fixture never
// authenticated at all — a typo'd email, a mock that returns undefined, a route
// that 500s. So the SAME stale session is also run against the OLD resolver, and
// it must succeed there. That is what makes the 401 evidence of the fix rather
// than evidence of a broken test.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { AppContext } from '@blackcode/platform-api'
import { tokensRoute } from '@blackcode/platform-api/routes'

// `@/lib/api` pulls in this app's eager Drizzle client, which throws when
// DATABASE_URL is unset. A localhost URL is enough: node-postgres builds the
// Pool lazily and nothing here ever issues a query — the assertions below all
// stop at the 401, before any database call.
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/unused'
process.env.PLATFORM_DB_DRIVER = 'pg'

const RESET_AT = new Date('2026-08-01T10:00:00Z')

// The user, as the database has them: they reset their password at RESET_AT.
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
// `authOptions` drags the whole next-auth provider chain in; the resolver only
// passes it through, so a stub keeps this a unit test.
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/db/queries/users', () => ({
  getUserByEmail: async (email: string) => (email === USER.email ? USER : null),
}))

/**
 * What the token routes used to do: session exists → you are that user.
 *
 * Cast at the call site rather than fleshing USER out into a full row — the
 * fields below are every field either resolver reads, and inventing the other
 * nine would only make the fixture look more authoritative than it is.
 */
async function legacyResolver() {
  const session = (await getServerSession({})) as typeof STALE_SESSION | null
  if (!session?.user?.email) return null
  return session.user.email === USER.email ? USER : null
}

/** Call GET /api/tokens with a given session resolver, return the status. */
async function tokensStatus(
  resolveSessionUser: AppContext['resolveSessionUser']
): Promise<number> {
  const ctx = {
    appSlug: 'issues',
    db: {
      // listTokens is the only db call GET makes, and only after auth passes.
      async execute() {
        return { rows: [] as Record<string, unknown>[] }
      },
    },
    async resolveUser() {
      throw new Error(
        'the tokens route reached resolveUser — the bearer-token path must never be ' +
          'available here, that is the privilege escalation the route exists to prevent'
      )
    },
    resolveSessionUser,
  } as unknown as AppContext

  const { GET } = tokensRoute(ctx)
  const res = await GET(new NextRequest('https://issues.blackcode.test/api/tokens'), undefined)
  return res.status
}

describe('/api/tokens rejects sessions a password reset invalidated', () => {
  beforeEach(() => {
    getServerSession.mockReset()
  })

  it('THE PREMISE: the old resolver let the stale session through', async () => {
    getServerSession.mockResolvedValue(STALE_SESSION)
    expect(
      await tokensStatus(legacyResolver as unknown as AppContext['resolveSessionUser']),
      'the stale-session fixture did not authenticate even against the OLD resolver, so ' +
        'the assertion below would pass for the wrong reason. Fix this fixture first.'
    ).toBe(200)
  })

  it('the validated resolver rejects it', async () => {
    getServerSession.mockResolvedValue(STALE_SESSION)
    const { getValidatedSessionUser } = await import('@/lib/auth/session')
    expect(await tokensStatus(getValidatedSessionUser)).toBe(401)
  })

  it('and still accepts a session issued after the reset', async () => {
    getServerSession.mockResolvedValue(FRESH_SESSION)
    const { getValidatedSessionUser } = await import('@/lib/auth/session')
    expect(
      await tokensStatus(getValidatedSessionUser),
      'the fix must not lock out valid sessions — a check that rejects everything is not a check'
    ).toBe(200)
  })

  // The three cases above compare two RESOLVERS. None of them would notice
  // apps/issues being wired back to the legacy one — the resolvers would still
  // behave exactly as asserted while the app used the wrong of the two. So this
  // case runs the REAL appContext, which is the thing that can regress.
  it('THE WIRING: this app\'s appContext uses the validated resolver', async () => {
    getServerSession.mockResolvedValue(STALE_SESSION)
    const { appContext } = await import('@/lib/api')
    const { getValidatedSessionUser } = await import('@/lib/auth/session')

    expect(
      appContext.resolveSessionUser,
      'apps/issues must supply getValidatedSessionUser as resolveSessionUser'
    ).toBe(getValidatedSessionUser)

    // And prove it end to end rather than only by identity.
    expect(await tokensStatus(appContext.resolveSessionUser)).toBe(401)
  })

  it('rejects a soft-deleted user holding a valid-looking session', async () => {
    getServerSession.mockResolvedValue(FRESH_SESSION)
    USER.deleted_at = new Date()
    try {
      const { getValidatedSessionUser } = await import('@/lib/auth/session')
      expect(await tokensStatus(getValidatedSessionUser)).toBe(401)
    } finally {
      USER.deleted_at = null
    }
  })
})
