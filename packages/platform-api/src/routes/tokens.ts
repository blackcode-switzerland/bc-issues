// /api/tokens and /api/tokens/{id} — the caller's own `bk_live_…` API tokens.
//
// ---------------------------------------------------------------------------
// SESSION ONLY. THIS IS THE POINT OF THE ROUTE, NOT A DETAIL OF IT.
// ---------------------------------------------------------------------------
// These use `app.resolveSessionUser`, never `app.resolveUser`. Minting or
// listing API tokens WITH an API token is privilege escalation: a leaked token
// that can mint fresh, longer-lived tokens is unrecoverable, because revoking
// the original does not revoke what it made.
//
// So there is no fallback. An app that mounts these without supplying
// `resolveSessionUser` gets an exception AT MOUNT TIME — at import, before the
// first request — rather than a route that quietly accepts bearer tokens. A
// silent downgrade of an auth boundary is the failure this shape exists to make
// impossible, and "it still worked" is exactly how nobody would notice.

import { NextRequest, NextResponse } from 'next/server'
import { listTokens, mintToken, revokeToken } from '@blackcode/platform-auth'
import type { AppContext } from '../app-context'
import { Errors } from '../errors'
import { createApiHandler } from '../handler'
import { TOKEN_NAME_MAX } from '../limits'

/**
 * The session resolver, or a thrown error naming what is missing.
 *
 * Called at factory time (module scope of the mount file), so the failure lands
 * during the build / first import rather than on a request.
 */
function requireSessionResolver(app: AppContext, route: string) {
  if (!app.resolveSessionUser) {
    throw new Error(
      `${route} requires AppContext.resolveSessionUser, and "${app.appSlug}" does not supply one. ` +
        'This route is session-only on purpose: a bearer token minting another bearer token is ' +
        'privilege escalation. It will NOT fall back to resolveUser. Either give this app a ' +
        'session resolver, or do not mount this route.'
    )
  }
  return app.resolveSessionUser
}

export function tokensRoute(app: AppContext) {
  const resolveSessionUser = requireSessionResolver(app, 'GET/POST /api/tokens')
  const apiHandler = createApiHandler(app)

  const GET = apiHandler(async (req: NextRequest) => {
    const user = await resolveSessionUser(req)
    if (!user) throw Errors.unauthorized()
    return NextResponse.json(await listTokens(app.db, user.id))
  })

  const POST = apiHandler(async (req: NextRequest) => {
    const user = await resolveSessionUser(req)
    if (!user) throw Errors.unauthorized()

    let body: { name?: string; expires_at?: string | null } = {}
    try {
      body = await req.json()
    } catch {
      /* empty body is fine */
    }

    const name = (body.name ?? '').trim()
    if (!name) throw Errors.badRequest('invalid_name', 'name is required')
    if (name.length > TOKEN_NAME_MAX) {
      throw Errors.badRequest(
        'name_too_long',
        `name max ${TOKEN_NAME_MAX} chars (got ${name.length})`
      )
    }

    let expires_at: Date | null = null
    if (body.expires_at) {
      const parsed = new Date(body.expires_at)
      if (Number.isNaN(parsed.getTime())) {
        throw Errors.badRequest(
          'invalid_expires_at',
          'expires_at must be an ISO 8601 datetime, e.g. 2027-01-01T00:00:00Z'
        )
      }
      if (parsed.getTime() <= Date.now()) {
        throw Errors.badRequest('expires_at_in_past', 'expires_at must be in the future')
      }
      expires_at = parsed
    }

    const minted = await mintToken(app.db, { user_id: user.id, name, expires_at })
    return NextResponse.json(minted, { status: 201 })
  })

  return { GET, POST }
}

interface TokenParams {
  params: Promise<{ id: string }>
}

export function tokenRoute(app: AppContext) {
  const resolveSessionUser = requireSessionResolver(app, 'DELETE /api/tokens/{id}')
  const apiHandler = createApiHandler(app)

  const DELETE = apiHandler(async (req: NextRequest, { params }: TokenParams) => {
    const user = await resolveSessionUser(req)
    if (!user) throw Errors.unauthorized()

    const { id } = await params
    const tokenId = parseInt(id, 10)
    if (Number.isNaN(tokenId)) throw Errors.badRequest('invalid_id', 'token id must be an integer')

    const ok = await revokeToken(app.db, tokenId, user.id)
    if (!ok) throw Errors.notFound('token')
    return NextResponse.json({ deleted: true })
  })

  return { DELETE }
}
