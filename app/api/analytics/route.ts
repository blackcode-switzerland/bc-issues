// Legacy /api/analytics — the convenience shim the `bk` CLI uses. Resolves the
// workspace from the caller (active workspace, or a `?ws=<slug|id>` override)
// and forwards to computeAnalytics(). Accepts the SAME query params as the
// canonical /api/workspaces/[ws]/analytics route (view, id, from, to, interval,
// and the status/priority/label/assignee filters) via parseAnalyticsParams — so
// the CLI has full parity with the web dashboard.
//
// The legacy admin-only gating is dropped; analytics is visible to any member.

import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors, parseAnalyticsParams } from '@/lib/api'
import { getUserById } from '@/lib/db/queries/users'
import { computeAnalytics } from '@/lib/db/queries/analytics'
import { getWorkspaceForUser } from '@/lib/db/queries/workspaces'

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()

  const sp = request.nextUrl.searchParams

  // Workspace selection: explicit ?ws= override (slug or id), else the caller's
  // active workspace. getWorkspaceForUser validates membership in both cases.
  const wsParam = sp.get('ws') ?? sp.get('workspace')
  let slugOrId = wsParam
  if (!slugOrId) {
    const fresh = await getUserById(user.id)
    if (!fresh?.active_workspace_id) {
      return NextResponse.json({
        scope: { type: 'workspace', id: null, label: '' },
        summary: { total_issues: 0 },
        message: 'no_active_workspace',
      })
    }
    slugOrId = String(fresh.active_workspace_id)
  }

  const ws = await getWorkspaceForUser(slugOrId, user.id)
  if (!ws) throw Errors.notFound('workspace')

  const { view, id, from, to, interval, filters } = parseAnalyticsParams(sp)

  const payload = await computeAnalytics({
    workspaceId: ws.id,
    view,
    id,
    from,
    to,
    interval,
    filters,
  })
  return NextResponse.json(payload)
})
