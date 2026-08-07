// GET    /api/workspaces/{ws}/communications/{n} — one logged message
// DELETE /api/workspaces/{ws}/communications/{n} — bin it
//
// There is no PATCH, and that is a decision rather than an omission. A
// communication is a RECORD of something that happened at a moment. Editing the
// body of a call summary is legitimate; editing the channel or the direction is
// rewriting history, and the two cannot be distinguished by a route. Log a
// correction as a `note` instead — which is what the channel is for.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { getCommBySeq, softDeleteCommunication } from '@/lib/db/queries/ledger'
import { publicComm } from '@/lib/views'
import { requireNumberParam, str } from '@/lib/http-input'

interface Params {
  params: Promise<{ ws: string; n: string }>
}

const notFound = (seq: number) =>
  Errors.notFound(
    'communication_not_found',
    `no communication #${seq} in this workspace`,
    'run `bk sales comm list` to find it'
  )

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'communication')
  const row = await getCommBySeq(ctx.workspace.id, seq)
  if (!row) throw notFound(seq)
  return NextResponse.json(publicComm(row, ctx.workspace.slug))
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'communication')

  const existing = await getCommBySeq(ctx.workspace.id, seq)
  if (!existing) throw notFound(seq)

  // The confirmation target is the PROSPECT NAME. A communication's own subject
  // is often empty (a call, a note), so it cannot be the thing repeated back —
  // and "which company is this against" is the fact a caller must have checked
  // before removing a record of contact with them.
  const confirm = str(req.nextUrl.searchParams.get('confirm'))
  if (!confirm) {
    throw Errors.badRequest(
      'confirm_required',
      'binning a communication requires the prospect name repeated back',
      `pass --confirm ${JSON.stringify(existing.prospect_name)}`
    )
  }
  if (confirm !== existing.prospect_name) {
    throw Errors.conflict(
      'confirm_mismatch',
      `--confirm ${JSON.stringify(confirm)} does not name the prospect on #${seq}`,
      `#${seq} is logged against ${JSON.stringify(existing.prospect_name)}`
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await softDeleteCommunication(ctx.workspace.id, seq, actor)
  if (!row) throw notFound(seq)
  return NextResponse.json({
    deleted: true,
    type: 'communication',
    number: row.seq,
    name: row.subject ?? `${row.channel} · ${row.direction}`,
  })
})
