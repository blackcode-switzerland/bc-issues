// PATCH  /api/workspaces/{ws}/prospects/{n}/objections/{oid} — counter, resolve, edit
// DELETE /api/workspaces/{ws}/prospects/{n}/objections/{oid} — destroy it
//
// **The DELETE here is HARD, and it is the only one in this app.**
// `sales.objections` carries no `deleted_at`: an objection is a note about a
// conversation, not an addressable record, so there is no #number for a recycle
// bin to list it under and nothing for `bk sales trash restore` to take. That is
// why the command requires a confirmation like the other irreversible ones, and
// why the event it writes carries what the row said.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import {
  deleteObjection,
  prospectIdBySeq,
  updateObjection,
} from '@/lib/db/queries/prospect-children'
import { publicObjection } from '@/lib/views'
import { nullableStr, requireNumberParam, str } from '@/lib/http-input'
import { OBJECTION_STATUS_VALUES, OBJECTION_TYPE_VALUES } from '@/lib/pipeline'

interface Params {
  params: Promise<{ ws: string; n: string; oid: string }>
}

async function resolveIds(workspaceId: number, n: string, oid: string) {
  const seq = requireNumberParam(n, 'prospect')
  const prospectId = await prospectIdBySeq(workspaceId, seq)
  if (prospectId == null) {
    throw Errors.notFound(
      'prospect_not_found',
      `no prospect #${seq} in this workspace`,
      'run `bk sales prospect list --q <name>` to find it'
    )
  }
  const objectionId = Number(oid)
  if (!Number.isInteger(objectionId) || objectionId <= 0) {
    throw Errors.notFound(
      'objection_not_found',
      `${JSON.stringify(oid)} is not an objection id`,
      `run \`bk sales objection list ${seq}\` for the ids`
    )
  }
  return { seq, prospectId, objectionId }
}

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n, oid } = await params
  const ctx = await resolveWorkspace(req, ws)
  const ids = await resolveIds(ctx.workspace.id, n, oid)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const status = str(body?.status)
  if (status && !OBJECTION_STATUS_VALUES.includes(status)) {
    throw Errors.badRequest(
      'unknown_status',
      `unknown objection status ${JSON.stringify(status)}`,
      'run `bk meta` for the current values'
    )
  }
  const type = str(body?.type)
  if (type && !OBJECTION_TYPE_VALUES.includes(type)) {
    throw Errors.badRequest(
      'unknown_objection_type',
      `unknown objection type ${JSON.stringify(type)}`,
      'run `bk meta` for the current objection types'
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await updateObjection(
    ctx.workspace.id,
    ids.prospectId,
    ids.objectionId,
    {
      status,
      type,
      spoken: nullableStr(body?.spoken),
      realFear: nullableStr(body?.real_fear),
      counter: nullableStr(body?.counter),
    },
    actor
  )
  if (!row) {
    throw Errors.notFound(
      'objection_not_found',
      `no objection ${ids.objectionId} on prospect #${ids.seq}`,
      `run \`bk sales objection list ${ids.seq}\` for the ids`
    )
  }
  return NextResponse.json(publicObjection(row))
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n, oid } = await params
  const ctx = await resolveWorkspace(req, ws)
  const ids = await resolveIds(ctx.workspace.id, n, oid)

  // The confirmation is the objection TYPE, checked here as well as in the
  // binary — same reasoning as the prospect delete, and it matters more here
  // because there is no recycle bin behind it.
  const confirm = str(req.nextUrl.searchParams.get('confirm'))
  if (!confirm) {
    throw Errors.badRequest(
      'confirm_required',
      'removing an objection is permanent and requires --confirm <type>',
      `run \`bk sales objection list ${ids.seq}\` to see the type at that id`
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await deleteObjection(ctx.workspace.id, ids.prospectId, ids.objectionId, actor)
  if (!row) {
    throw Errors.notFound(
      'objection_not_found',
      `no objection ${ids.objectionId} on prospect #${ids.seq}`,
      `run \`bk sales objection list ${ids.seq}\` for the ids`
    )
  }
  if (confirm !== row.type) {
    // The row is already gone by the time we know — so this branch cannot
    // happen without the read below being wrong. Kept as an assertion rather
    // than a check: see the delete function, which returns the row it removed.
    throw Errors.conflict(
      'confirm_mismatch',
      `--confirm ${JSON.stringify(confirm)} does not name objection ${ids.objectionId}`,
      `it was ${JSON.stringify(row.type)}`
    )
  }
  return NextResponse.json({
    deleted: true,
    type: 'objection',
    id: row.id,
    objection_type: row.type,
    spoken: row.spoken,
  })
})
