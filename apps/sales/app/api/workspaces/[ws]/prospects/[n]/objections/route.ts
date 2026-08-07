// GET  /api/workspaces/{ws}/prospects/{n}/objections — what they pushed back on
// POST /api/workspaces/{ws}/prospects/{n}/objections — raise one
//
// Three text columns, kept apart: what they SAID, what we think they MEAN, and
// what we say back. Collapsing them into one notes field would delete the only
// structured sales insight in the product — see `schema.ts` at `objections`.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { listObjections, prospectIdBySeq, raiseObjection } from '@/lib/db/queries/prospect-children'
import { publicObjection } from '@/lib/views'
import { requireNumberParam, str } from '@/lib/http-input'
import { OBJECTION_TYPE_VALUES } from '@/lib/pipeline'

interface Params {
  params: Promise<{ ws: string; n: string }>
}

async function requireProspect(workspaceId: number, raw: string): Promise<number> {
  const seq = requireNumberParam(raw, 'prospect')
  const id = await prospectIdBySeq(workspaceId, seq)
  if (id == null) {
    throw Errors.notFound(
      'prospect_not_found',
      `no prospect #${seq} in this workspace`,
      'run `bk sales prospect list --q <name>` to find it'
    )
  }
  return id
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const prospectId = await requireProspect(ctx.workspace.id, n)
  return jsonList((await listObjections(prospectId)).map(publicObjection), null)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const prospectId = await requireProspect(ctx.workspace.id, n)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const type = str(body?.type)
  if (!type) {
    throw Errors.badRequest(
      'missing_type',
      'type is required',
      'run `bk meta` for the current objection types'
    )
  }
  if (!OBJECTION_TYPE_VALUES.includes(type)) {
    throw Errors.badRequest(
      'unknown_objection_type',
      `unknown objection type ${JSON.stringify(type)}`,
      'run `bk meta` for the current objection types'
    )
  }

  const raisedAtRaw = str(body?.raised_at)
  const raisedAt = raisedAtRaw ? new Date(raisedAtRaw) : null
  if (raisedAt && Number.isNaN(raisedAt.getTime())) {
    throw Errors.badRequest(
      'invalid_raised_at',
      `raised_at is not a timestamp: ${JSON.stringify(raisedAtRaw)}`,
      'pass an ISO 8601 timestamp, e.g. 2026-08-07T14:00:00Z'
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await raiseObjection(
    ctx.workspace.id,
    prospectId,
    {
      type,
      raisedBy: str(body?.raised_by) ?? null,
      raisedAt,
      spoken: str(body?.spoken) ?? null,
      realFear: str(body?.real_fear) ?? null,
    },
    actor
  )
  return NextResponse.json(publicObjection(row), { status: 201 })
})
