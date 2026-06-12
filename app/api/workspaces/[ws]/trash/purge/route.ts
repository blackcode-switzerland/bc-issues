// DELETE /api/workspaces/[ws]/trash/purge — permanently delete items or a whole
// batch from the bin. Owner-only (this is the one irreversible action).
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, requireOwner, resolveWorkspace } from '@/lib/api'
import { purgeBatch, purgeItems } from '@/lib/db/queries/deletion'
import { parseSelection } from '../parse'

interface Params {
  params: Promise<{ ws: string }>
}

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  const body = await req.json().catch(() => null)
  const { batchId, items } = parseSelection(body)

  const result =
    batchId !== null
      ? await purgeBatch(ctx.workspace.id, batchId, ctx.user.id)
      : await purgeItems(ctx.workspace.id, items, ctx.user.id)
  return NextResponse.json({ purged: result.purged })
})
