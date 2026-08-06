// POST /api/cli/authorize — the browser half of `bk login`.
//
// ---------------------------------------------------------------------------
// EVERY DEPLOYED APP SERVES THIS (D-21)
// ---------------------------------------------------------------------------
// `bk login --server https://sales.blackcode.ch` is a legitimate command: an
// agent naming the app it is about to work in. If that app does not serve the
// authorize step, the command dead-ends on a 404 — the exact invisible failure
// D-1 exists to remove. So this is Tier 1 for every app, not for the one that
// happens to host the login page today.
//
// The token it mints is the SAME `bk_live_…` credential everywhere: one binary,
// one login, one `platform.api_tokens` (docs/platform-architecture.md §6).
// Authorising through sales does not produce a sales-only token, and must not —
// which is exactly why this is a shared factory rather than a per-app route each
// app could scope differently.
//
// ---------------------------------------------------------------------------
// SESSION ONLY, LIKE /api/tokens, AND FOR THE SAME REASON
// ---------------------------------------------------------------------------
// This route MINTS A TOKEN. Accepting a bearer token here would let one
// credential mint another, which is privilege escalation and unrecoverable:
// revoking the first would not revoke the second. So it takes
// `AppContext.resolveSessionUser` and throws at mount time when an app does not
// supply one, exactly as the tokens routes do — no fallback.
//
// **`resolveSessionUser` must reject a session invalidated by a password reset.**
// That is not a suggestion this file can enforce, but it is the whole of D-24 and
// of the 2026-08-06 fix to this route: until then it authenticated with a bare
// `getServerSession` + `getUserByEmail`, so a session captured before a reset
// could still be walked through `bk login` and come out holding a permanent
// credential. `apps/issues` supplies `getValidatedSessionUser`; an app that
// supplies something weaker reopens that hole for everybody, because the token
// is platform-wide.

import { NextRequest, NextResponse } from 'next/server'
import { buildCallbackRedirect, mintToken } from '@blackcode/platform-auth'
import { requireSessionResolver, type AppContext } from '../app-context'
import { TOKEN_NAME_MAX } from '../limits'

export function cliAuthorizeRoute(app: AppContext) {
  const resolveSessionUser = requireSessionResolver(app, 'POST /api/cli/authorize')

  // Not wrapped in `apiHandler`, and that is preserved rather than chosen: this
  // route answers `{ error, suggestion }` bodies the installed `bk` binaries
  // already parse. Routing it through the platform envelope would change the
  // shape of a response every deployed CLI reads during login.
  return async function POST(request: NextRequest): Promise<NextResponse> {
    const user = await resolveSessionUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: { callback?: string; state?: string; name?: string } = {}
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const callback = (body.callback ?? '').trim()
    const state = (body.state ?? '').trim()
    if (!callback) {
      return NextResponse.json(
        { error: 'Missing callback', suggestion: 'Provide a localhost callback URL' },
        { status: 400 }
      )
    }
    if (!state) {
      return NextResponse.json({ error: 'Missing state' }, { status: 400 })
    }

    const proposedName = (body.name ?? '').trim()
    const tokenName =
      proposedName.length > 0 && proposedName.length <= TOKEN_NAME_MAX
        ? proposedName
        : `cli-${new Date().toISOString().slice(0, 10)}`

    const minted = await mintToken(app.db, { user_id: user.id, name: tokenName })

    const redirect = buildCallbackRedirect(callback, {
      token: minted.plaintext,
      state,
    })
    if (!redirect) {
      return NextResponse.json(
        {
          error: 'Invalid callback',
          suggestion: 'Callback must be an http://localhost or http://127.0.0.1 URL',
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      redirect_url: redirect,
      token_id: minted.id,
      token_name: tokenName,
    })
  }
}
