// DELETE /api/workspaces/{ws}/trash/purge — destroy binned records for good
//
// ---------------------------------------------------------------------------
// IT REPORTS WHAT IT DESTROYED, NOT HOW MANY
// ---------------------------------------------------------------------------
// Every item in the response was read BEFORE its row was deleted, and it is the
// only remaining record of what went: the row is gone and its projection with
// it. `bk sales trash purge` prints each one and `platform.events` keeps them.
//
// A count alone is the difference between a wrong purge somebody catches in a
// minute and one nobody notices for a month — and it is also the last line of
// defence against a stale ref, because a caller that pasted the wrong number
// sees the TITLE of what it actually deleted.
//
// Owner only. This is the product's one irreversible action in this app.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, requireOwner } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { isTrashType, purgeItems, TRASH_TYPES, type TrashType } from '@/lib/db/queries/trash'

interface Params {
  params: Promise<{ ws: string }>
}

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  if (body?.batch_id != null) {
    throw Errors.badRequest(
      'no_batches',
      'this app does not group deletes into batches',
      `purge by ref instead — e.g. \`bk sales trash purge ${TRASH_TYPES[0]}:12\``
    )
  }

  const raw = Array.isArray(body?.items) ? (body.items as Array<Record<string, unknown>>) : []
  const items: Array<{ type: TrashType; number: number }> = []
  for (const it of raw) {
    const type = String(it.type ?? '')
    const number = Number(it.number ?? it.id ?? 0)
    if (isTrashType(type) && Number.isInteger(number) && number > 0) {
      items.push({ type, number })
    }
  }
  if (items.length === 0) {
    throw Errors.badRequest(
      'no_items',
      'pass one or more <type:#number> refs',
      'run `bk sales trash list` for the refs, or `bk sales trash empty` for everything'
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const purged = await purgeItems(ctx.workspace.id, { items }, actor)
  return NextResponse.json({
    purged: purged.length,
    items: purged.map((p) => ({ type: p.type, number: p.number, title: p.title })),
  })
})
