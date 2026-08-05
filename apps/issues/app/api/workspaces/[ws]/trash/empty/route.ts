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
  // `items` echoes WHAT was destroyed, not just how many. A wrong purge should
  // be visible the moment it happens rather than discovered a month later, and
  // this is the only moment the titles still exist. Capped and truncation
  // reported — a sample that reads as the whole list is its own kind of lie.
  return NextResponse.json({
    purged: result.purged,
    items: result.items,
    items_truncated: result.items_truncated,
  })
})
