// GET /api/workspaces/{ws}/pipeline — where the money is, by stage
//
// Every stage appears, including the empty ones, in pipeline order: a funnel
// that silently omits the stage nobody is in hides the thing worth noticing.
// Computed by query — there is no aggregates table and there must not be (D-33).
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { pipeline } from '@/lib/db/queries/aggregates'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  return NextResponse.json(await pipeline(ctx.workspace.id))
})
