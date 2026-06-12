// POST /api/workspaces/[ws]/trash/empty — permanently delete everything in the
// bin. Owner-only.
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, requireOwner, resolveWorkspace } from '@/lib/api'
import { emptyTrash } from '@/lib/db/queries/deletion'

interface Params {
  params: Promise<{ ws: string }>
}

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)
  const result = await emptyTrash(ctx.workspace.id, ctx.user.id)
  return NextResponse.json({ purged: result.purged })
})
