// POST /api/workspaces/[ws]/trash/restore — restore items or a whole batch.
// Any workspace member. With { dry_run: true } it returns the conflict preview
// (which restored items have a binned/missing parent) instead of mutating, so
// the UI can ask the user how to resolve before committing.
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace } from '@/lib/api'
import {
  batchMembers,
  previewRestore,
  restoreBatch,
  restoreItems,
  TrashItemNotFoundError,
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
  try {
    const result =
      batchId !== null
        ? await restoreBatch(ctx.workspace.id, batchId, ctx.user.id)
        : await restoreItems(ctx.workspace.id, items, ctx.user.id, resolutions)
    return NextResponse.json({ restored: result.restored, count: result.restored.length })
  } catch (err) {
    // A ref that is not in this workspace's bin is a 404, not a silent success.
    // The suggestion names the one command that produces valid refs, because the
    // most likely mistake is exactly the one made during Phase 6 verification:
    // passing the #number seen everywhere else instead of the ref `trash list`
    // prints.
    if (err instanceof TrashItemNotFoundError) {
      throw Errors.notFound(
        'not_in_trash',
        `not in this workspace's trash: ${err.refs.map((r) => `${r.type}:${r.id}`).join(', ')}`,
        'run `bk trash list` and pass a REF exactly as printed in its REF column'
      )
    }
    throw err
  }
})
