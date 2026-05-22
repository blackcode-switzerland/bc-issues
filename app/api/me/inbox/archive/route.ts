import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { archiveMessages } from '@/lib/db/queries/inbox'

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((n: unknown): n is number => typeof n === 'number')
    : []
  if (ids.length === 0) {
    throw Errors.badRequest('missing_ids', 'provide ids: number[]')
  }

  const count = await archiveMessages(user.id, ids)
  return NextResponse.json({ archived: count })
})
