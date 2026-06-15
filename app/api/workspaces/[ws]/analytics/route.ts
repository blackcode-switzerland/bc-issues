import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, parseAnalyticsParams, resolveWorkspace } from '@/lib/api'
import { computeAnalytics } from '@/lib/db/queries/analytics'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const { view, id, from, to, interval, filters } = parseAnalyticsParams(req.nextUrl.searchParams)

  const payload = await computeAnalytics({
    workspaceId: ctx.workspace.id,
    view,
    id,
    from,
    to,
    interval,
    filters,
  })
  return NextResponse.json(payload)
})
