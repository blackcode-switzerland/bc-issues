// Legacy /api/analytics — uses the user's active workspace and forwards to
// the new computeAnalytics(). The legacy admin-only gating is dropped; analytics
// is now visible to any workspace member.

import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { getUserById } from '@/lib/db/queries/users'
import { computeAnalytics } from '@/lib/db/queries/analytics'
import { getWorkspaceForUser } from '@/lib/db/queries/workspaces'

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()

  const fresh = await getUserById(user.id)
  if (!fresh?.active_workspace_id) {
    return NextResponse.json({
      scope: { type: 'workspace', id: null, label: '' },
      summary: { total_issues: 0 },
      message: 'no_active_workspace',
    })
  }
  const ws = await getWorkspaceForUser(String(fresh.active_workspace_id), user.id)
  if (!ws) {
    throw Errors.notFound('workspace')
  }

  const payload = await computeAnalytics({
    workspaceId: ws.id,
    view: 'workspace',
  })
  return NextResponse.json(payload)
})
