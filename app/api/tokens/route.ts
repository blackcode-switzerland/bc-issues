import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { apiHandler, Errors } from '@/lib/api'
import { authOptions } from '@/lib/auth'
import { getUserByEmail } from '@/lib/db/queries/users'
import { listTokens, mintToken } from '@/lib/auth/tokens'

// Token management is session-only on purpose: minting or listing API tokens
// with an API token would be privilege escalation, so these require a browser
// session (not a bk_live_… bearer).
async function sessionUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return getUserByEmail(session.user.email)
}

export const GET = apiHandler(async () => {
  const user = await sessionUser()
  if (!user) throw Errors.unauthorized()
  const tokens = await listTokens(user.id)
  return NextResponse.json(tokens)
})

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await sessionUser()
  if (!user) throw Errors.unauthorized()

  let body: { name?: string; expires_at?: string | null } = {}
  try {
    body = await request.json()
  } catch {
    /* empty body is fine */
  }

  const name = (body.name ?? '').trim()
  if (!name) throw Errors.badRequest('invalid_name', 'name is required')
  if (name.length > 100) throw Errors.badRequest('name_too_long', `name max 100 chars (got ${name.length})`)

  let expires_at: Date | null = null
  if (body.expires_at) {
    const parsed = new Date(body.expires_at)
    if (Number.isNaN(parsed.getTime())) {
      throw Errors.badRequest('invalid_expires_at', 'expires_at must be an ISO 8601 datetime, e.g. 2027-01-01T00:00:00Z')
    }
    if (parsed.getTime() <= Date.now()) {
      throw Errors.badRequest('expires_at_in_past', 'expires_at must be in the future')
    }
    expires_at = parsed
  }

  const minted = await mintToken({ user_id: user.id, name, expires_at })
  return NextResponse.json(minted, { status: 201 })
})
