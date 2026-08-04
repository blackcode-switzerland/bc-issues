import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, parseAnalyticsParams, resolveWorkspace, resolveEntityId } from '@/lib/api'
import { computeAnalytics } from '@/lib/db/queries/analytics'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const { view, id, from, to, interval, filters } = parseAnalyticsParams(req.nextUrl.searchParams)

  // For project/task scope, `id` is the workspace #number (seq) → resolve to the
  // internal id. For member scope it's a user id; for workspace there's no id.
  let internalId = id
  if (id != null && (view === 'project' || view === 'task')) {
    internalId = await resolveEntityId(ctx.workspace.id, view, String(id))
  }

  const payload = await computeAnalytics({
    workspaceId: ctx.workspace.id,
    view,
    id: internalId,
    from,
    to,
    interval,
    filters,
  })
  return NextResponse.json(payload)
})
