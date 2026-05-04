import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getUserByEmail } from '@/lib/db/queries/users'
import { listTokens, mintToken } from '@/lib/auth/tokens'

async function sessionUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return getUserByEmail(session.user.email)
}

export async function GET() {
  const user = await sessionUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tokens = await listTokens(user.id)
  return NextResponse.json(tokens)
}

export async function POST(request: NextRequest) {
  const user = await sessionUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { name?: string; expires_at?: string | null } = {}
  try {
    body = await request.json()
  } catch {
    /* empty body is fine */
  }

  const name = (body.name ?? '').trim()
  if (!name) {
    return NextResponse.json(
      { error: 'Invalid name', suggestion: 'Provide a non-empty `name` field' },
      { status: 400 }
    )
  }
  if (name.length > 100) {
    return NextResponse.json(
      { error: 'Name too long', suggestion: `Max 100 chars, you sent ${name.length}` },
      { status: 400 }
    )
  }

  let expires_at: Date | null = null
  if (body.expires_at) {
    const parsed = new Date(body.expires_at)
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: 'Invalid expires_at', suggestion: 'ISO 8601 datetime, e.g. 2027-01-01T00:00:00Z' },
        { status: 400 }
      )
    }
    if (parsed.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: 'expires_at is in the past' },
        { status: 400 }
      )
    }
    expires_at = parsed
  }

  const minted = await mintToken({ user_id: user.id, name, expires_at })
  return NextResponse.json(minted, { status: 201 })
}
