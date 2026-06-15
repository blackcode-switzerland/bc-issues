import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { markRead } from '@/lib/db/queries/inbox'

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((n: unknown): n is number => typeof n === 'number')
    : undefined
  const all = body.all === true
  const workspaceId = typeof body.workspace_id === 'number' ? body.workspace_id : undefined

  if (!ids && !all) {
    throw Errors.badRequest('missing_target', 'provide ids: number[] or all: true')
  }

  const count = await markRead(user.id, { ids, all, workspaceId })
  return NextResponse.json({ marked_read: count })
})
