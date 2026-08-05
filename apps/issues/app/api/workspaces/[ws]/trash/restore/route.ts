// POST /api/workspaces/[ws]/trash/restore — restore items or a whole batch.
// Any workspace member. With { dry_run: true } it returns the conflict preview
// (which restored items have a binned/missing parent) instead of mutating, so
// the UI can ask the user how to resolve before committing.
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace } from '@/lib/api'
import {
  batchMembers,
  numbersForRefs,
  previewRestore,
  restoreBatch,
  restoreItems,
  TrashItemNotFoundError,
  type RestorePreview,
} from '@/lib/db/queries/deletion'
import { parseResolutions, parseSelection } from '../parse'
import { remapResolutionKeys, resolveSelection } from '../resolve'

interface Params {
  params: Promise<{ ws: string }>
}

/**
 * Add `#number` alongside every row id in a conflict preview.
 *
 * The client keys its resolutions off what this returns, so the preview has to
 * speak the same addresses as the listing. Row ids stay in the payload: the UI
 * still uses them, and dropping a field an existing client reads is the kind of
 * break that shows up only in production.
 */
async function withNumbers(workspaceId: number, preview: RestorePreview) {
  const refs = [
    ...preview.items,
    ...preview.conflicts.map((c) => ({ type: c.type, id: c.id })),
    ...preview.conflicts.map((c) => ({ type: c.parent_type, id: c.parent_id })),
  ]
  const numbers = await numbersForRefs(workspaceId, refs)
  const numberOf = (type: string, id: number) => numbers.get(`${type}:${id}`) ?? null
  return {
    items: preview.items.map((r) => ({ ...r, number: numberOf(r.type, r.id) })),
    conflicts: preview.conflicts.map((c) => ({
      ...c,
      number: numberOf(c.type, c.id),
      parent_number: numberOf(c.parent_type, c.parent_id),
    })),
  }
}

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = await req.json().catch(() => null)
  const selection = parseSelection(body)
  const batchId = selection.batchId
  const dryRun = !!(body && typeof body === 'object' && (body as Record<string, unknown>).dry_run)

  // Resolve the working set of refs. A `#number` that matches nothing 404s here,
  // before anything is touched.
  const items = await resolveSelection(ctx.workspace.id, selection)
  const refs = batchId !== null ? await batchMembers(ctx.workspace.id, batchId) : items

  if (dryRun) {
    const preview = await previewRestore(ctx.workspace.id, refs)
    return NextResponse.json(await withNumbers(ctx.workspace.id, preview))
  }

  // Resolution keys arrive keyed by whatever the client used to address the
  // item — #number for 1.12.0+, row id before that. `restoreEntity` looks them
  // up by row id, so they are normalised here rather than deeper down, where a
  // missed key silently becomes "use the default resolution".
  const resolutions = remapResolutionKeys(selection, items, parseResolutions(body))
  try {
    const result =
      batchId !== null
        ? await restoreBatch(ctx.workspace.id, batchId, ctx.user.id)
        : await restoreItems(ctx.workspace.id, items, ctx.user.id, resolutions)
    const numbers = await numbersForRefs(ctx.workspace.id, result.restored)
    return NextResponse.json({
      restored: result.restored.map((r) => ({
        ...r,
        number: numbers.get(`${r.type}:${r.id}`) ?? null,
      })),
      count: result.restored.length,
    })
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
