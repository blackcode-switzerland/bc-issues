import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getUserByEmail } from '@/lib/db/queries/users'
import { mintToken } from '@/lib/auth/tokens'
import { buildCallbackRedirect } from '@/lib/auth/cli-callback'

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const user = await getUserByEmail(session.user.email)
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
