// POST /api/workspaces/{ws}/trash/empty — destroy everything in the bin
//
// Same reporting contract as `purge`: WHAT, not how many, captured before the
// delete. `items` is capped and `items_truncated` says how many are not listed —
// a sample that reads as the whole list is its own kind of lie.
//
// Owner only.
import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { emptyTrash } from '@/lib/db/queries/trash'

interface Params {
  params: Promise<{ ws: string }>
}

/** How many destroyed items to name in the response. */
const SAMPLE = 50

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  const actor = await resolveActor(getDb(), req, ctx.user)
  const purged = await emptyTrash(ctx.workspace.id, actor)
  return NextResponse.json({
    purged: purged.length,
    items: purged.slice(0, SAMPLE).map((p) => ({
      type: p.type,
      number: p.number,
      title: p.title,
    })),
    items_truncated: Math.max(0, purged.length - SAMPLE),
  })
})
