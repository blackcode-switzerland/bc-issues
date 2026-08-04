// POST /api/workspaces/[ws]/trash/restore — restore items or a whole batch.
// Any workspace member. With { dry_run: true } it returns the conflict preview
// (which restored items have a binned/missing parent) instead of mutating, so
// the UI can ask the user how to resolve before committing.
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import {
  batchMembers,
  previewRestore,
  restoreBatch,
  restoreItems,
} from '@/lib/db/queries/deletion'
import { parseResolutions, parseSelection } from '../parse'

interface Params {
  params: Promise<{ ws: string }>
}

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = await req.json().catch(() => null)
  const { batchId, items } = parseSelection(body)
  const dryRun = !!(body && typeof body === 'object' && (body as Record<string, unknown>).dry_run)

  // Resolve the working set of refs.
  const refs = batchId !== null ? await batchMembers(ctx.workspace.id, batchId) : items

  if (dryRun) {
    const preview = await previewRestore(ctx.workspace.id, refs)
    return NextResponse.json(preview)
  }

  const resolutions = parseResolutions(body)
  const result =
    batchId !== null
      ? await restoreBatch(ctx.workspace.id, batchId, ctx.user.id)
      : await restoreItems(ctx.workspace.id, items, ctx.user.id, resolutions)
  return NextResponse.json({ restored: result.restored, count: result.restored.length })
})
