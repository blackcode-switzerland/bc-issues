import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { countUnread, listInbox } from '@/lib/db/queries/inbox'

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()

  const sp = request.nextUrl.searchParams
  const countOnly = sp.get('count_only') === 'true'
  const wsRaw = sp.get('workspace_id')
  let workspaceId: number | null | undefined
  if (wsRaw === 'null' || wsRaw === '') workspaceId = null
  else if (wsRaw) {
    const n = parseInt(wsRaw)
    if (Number.isNaN(n)) throw Errors.badRequest('invalid_workspace_id', 'workspace_id must be an integer or null')
    workspaceId = n
  }

  if (countOnly) {
    const count = await countUnread(user.id, workspaceId ?? undefined)
    return NextResponse.json({ unread_count: count })
  }

  const cursor = sp.get('cursor') ? parseInt(sp.get('cursor')!) : null
  if (cursor !== null && Number.isNaN(cursor)) {
    throw Errors.badRequest('invalid_cursor', 'cursor must be an integer')
  }
  const limit = sp.get('limit') ? parseInt(sp.get('limit')!) : undefined
  if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
    throw Errors.badRequest('invalid_limit', 'limit must be a positive integer')
  }

  const result = await listInbox({
    userId: user.id,
    workspaceId,
    type: sp.get('type'),
    unreadOnly: sp.get('unread') === 'true',
    includeArchived: sp.get('include_archived') === 'true',
    cursor,
    limit,
  })
  return NextResponse.json(result)
})
