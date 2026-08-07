// GET  /api/workspaces/{ws}/prospects/{n}/labels — this prospect's labels
// POST /api/workspaces/{ws}/prospects/{n}/labels — attach one
//
// `attach` and `detach` name an ENTITY, and an entity belongs to one app —
// which is exactly why `internal/appverbs` builds the shared half of
// `bk <app> label` and leaves these two to each app's own package. The same
// split on both sides is what keeps the parity guard honest: the claim is
// checked against the tree that actually serves it.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { attachLabel } from '@/lib/db/queries/labels'
import { getProspectBySeq } from '@/lib/db/queries/prospects'
import { requireNumberParam } from '@/lib/http-input'

interface Params {
  params: Promise<{ ws: string; n: string }>
}

const prospectNotFound = (seq: number) =>
  Errors.notFound(
    'prospect_not_found',
    `no prospect #${seq} in this workspace`,
    'run `bk sales prospect list --q <name>` to find it'
  )

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'prospect')
  const row = await getProspectBySeq(ctx.workspace.id, seq)
  if (!row) throw prospectNotFound(seq)
  return jsonList(row.labels, null)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'prospect')
  const row = await getProspectBySeq(ctx.workspace.id, seq)
  if (!row) throw prospectNotFound(seq)

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const labelId = Number(body?.label_id)
  if (!Number.isInteger(labelId) || labelId <= 0) {
    throw Errors.badRequest(
      'missing_label_id',
      'label_id is required',
      'run `bk sales label list` for the ids'
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const res = await attachLabel(ctx.workspace.id, row.id, labelId, actor)
  if (!res.ok && res.reason === 'label_not_found') {
    throw Errors.notFound(
      'label_not_found',
      `no label ${labelId} this app can see in this workspace`,
      'run `bk sales label list` — a label belonging to another app cannot be attached here'
    )
  }
  if (!res.ok) {
    throw Errors.conflict(
      'too_many_labels',
      `a prospect can carry at most ${res.max} labels`,
      'detach one first — run `bk meta` for the current limits'
    )
  }
  // `attached: false` means it was already there. A 200 rather than a 409,
  // because the caller asked for a state and the state is what it asked for.
  return NextResponse.json({ attached: res.attached, label: res.label.name }, { status: 201 })
})
