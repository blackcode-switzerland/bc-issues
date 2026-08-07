// POST /api/workspaces/{ws}/trash/restore — bring binned records back
//
// Restoring a prospect brings back the contacts, meetings and communications
// that went down WITH it, and only those: the cascade stamps one instant, so the
// inverse is exact. A meeting binned separately last week stays binned —
// restoring a prospect must not quietly undo somebody else's decision.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { isTrashType, restoreItem, TRASH_TYPES } from '@/lib/db/queries/trash'

interface Params {
  params: Promise<{ ws: string }>
}

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  // `--batch` is a real flag on the shared command and this app has no batches.
  // Refused with the reason, rather than ignored: a silently dropped filter is
  // how "restore batch 7" restores everything.
  if (body?.batch_id != null) {
    throw Errors.badRequest(
      'no_batches',
      'this app does not group deletes into batches',
      `restore by ref instead — e.g. \`bk sales trash restore ${TRASH_TYPES[0]}:12\``
    )
  }

  const items = Array.isArray(body?.items) ? (body.items as Array<Record<string, unknown>>) : []
  if (items.length === 0) {
    throw Errors.badRequest(
      'no_items',
      'pass one or more <type:#number> refs',
      'run `bk sales trash list` for the refs'
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const restored: Array<{ type: string; number: number }> = []
  const missing: string[] = []
  for (const it of items) {
    const type = String(it.type ?? '')
    const number = Number(it.number ?? it.id ?? 0)
    if (!isTrashType(type) || !Number.isInteger(number) || number <= 0) {
      missing.push(`${type || '?'}:${number || '?'}`)
      continue
    }
    const done = await restoreItem(ctx.workspace.id, type, number, actor)
    if (done) restored.push({ type: done.type, number: done.number })
    else missing.push(`${type}:${number}`)
  }

  // Nothing at all restored is a 404 rather than a cheerful `count: 0`: the
  // caller asked for specific refs and got none of them, and a success that
  // did nothing is the answer hardest to notice.
  if (restored.length === 0) {
    throw Errors.notFound(
      'nothing_restored',
      `nothing in the bin matches ${missing.join(', ')}`,
      'run `bk sales trash list` for the refs that are actually there'
    )
  }
  return NextResponse.json({ restored, count: restored.length, missing })
})
