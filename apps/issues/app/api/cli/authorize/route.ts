// POST /api/cli/authorize — the browser half of `bk login`.
//
// ── WHY THE VALIDATED SESSION RESOLVER, AS OF 2026-08-06 ────────────────────
// **This route mints a `bk_live_…` token.** It is the second one that does, and
// until today it authenticated with a bare `getServerSession` + `getUserByEmail`
// — the exact check D-24 removed from `/api/tokens` five commits ago, for the
// exact reason: that pair accepts a session belonging to a soft-deleted user,
// and a session issued BEFORE the account's last password reset.
//
// So a session captured before a reset could still walk through `bk login` and
// come out holding a permanent CLI credential, and revoking the session did not
// revoke the token. D-24's sentence applies here word for word: a password reset
// is what somebody does when they believe their account is compromised, and one
// that leaves the attacker able to create a permanent credential has not done
// its job.
//
// `getValidatedSessionUser` is what every other session path in this app uses.
// Fixed on its own, deliberately not folded into the extraction that found it.
import { NextRequest, NextResponse } from 'next/server'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { mintToken } from '@/lib/auth/tokens'
import { buildCallbackRedirect } from '@/lib/auth/cli-callback'

export async function POST(request: NextRequest) {
  const user = await getValidatedSessionUser()
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
    proposedName.length > 0 && proposedName.length <= 100
      ? proposedName
      : `cli-${new Date().toISOString().slice(0, 10)}`

  const minted = await mintToken({ user_id: user.id, name: tokenName })

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
