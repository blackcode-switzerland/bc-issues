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
  getObjection,
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

  // ── THE CONFIRMATION IS CHECKED BEFORE ANYTHING IS DESTROYED ──────────────
  // It used to be checked AFTER: the route deleted the row, compared `--confirm`
  // against what came back, and threw a 409 saying the objection was not the one
  // meant — having permanently removed it. There is no recycle bin behind this
  // delete, so that was the whole of the guard on the one irreversible operation
  // in this app. Fixed 2026-08-07; `lib/api/objection-delete-guard.test.ts`
  // watches it, and `deleteObjection` re-checks inside its own transaction under
  // FOR UPDATE so a concurrent edit cannot slip between the read and the delete.
  const confirm = str(req.nextUrl.searchParams.get('confirm'))
  const existing = await getObjection(ids.prospectId, ids.objectionId)
  if (!existing) {
    throw Errors.notFound(
      'objection_not_found',
      `no objection ${ids.objectionId} on prospect #${ids.seq}`,
      `run \`bk sales objection list ${ids.seq}\` for the ids`
    )
  }
  if (!confirm) {
    throw Errors.badRequest(
      'confirm_required',
      'removing an objection is permanent and requires --confirm <type>',
      `pass --confirm ${JSON.stringify(existing.type)}`
    )
  }
  if (confirm !== existing.type) {
    // The expected value IS echoed. Secrecy is not the point — the point is that
    // the caller must have looked at the row it is about to destroy, and an
    // agent on a wrong id learns here that the objection at that id is a
    // different one. Nothing has been removed.
    throw Errors.conflict(
      'confirm_mismatch',
      `--confirm ${JSON.stringify(confirm)} does not name objection ${ids.objectionId}`,
      `it is ${JSON.stringify(existing.type)} — nothing was removed`
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const result = await deleteObjection(
    ctx.workspace.id,
    ids.prospectId,
    ids.objectionId,
    confirm,
    actor
  )
  if (result.status !== 'deleted') {
    // Only reachable if the row changed between the read above and the
    // transaction below — which is exactly the case the second check exists for.
    throw Errors.conflict(
      'objection_changed',
      `objection ${ids.objectionId} changed while it was being removed`,
      `run \`bk sales objection list ${ids.seq}\` and try again — nothing was removed`
    )
  }
  return NextResponse.json({
    deleted: true,
    type: 'objection',
    id: result.row.id,
    objection_type: result.row.type,
    spoken: result.row.spoken,
  })
})
