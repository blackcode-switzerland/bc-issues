// DELETE /api/workspaces/[ws]/trash/purge — permanently delete items or a whole
// batch from the bin. Owner-only (this is the one irreversible action).
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, requireOwner, resolveWorkspace } from '@/lib/api'
import { purgeBatch, purgeItems } from '@/lib/db/queries/deletion'
import { parseSelection } from '../parse'
import { resolveSelection } from '../resolve'

interface Params {
  params: Promise<{ ws: string }>
}

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  const body = await req.json().catch(() => null)
  const selection = parseSelection(body)

  // Resolve BEFORE purging, and let an unknown #number 404 the whole call. A
  // partially-resolved selection on the one irreversible route is how the wrong
  // row gets destroyed.
  const items = await resolveSelection(ctx.workspace.id, selection)

  const result =
    selection.batchId !== null
      ? await purgeBatch(ctx.workspace.id, selection.batchId, ctx.user.id)
      : await purgeItems(ctx.workspace.id, items, ctx.user.id)
  return NextResponse.json({ purged: result.purged })
})
