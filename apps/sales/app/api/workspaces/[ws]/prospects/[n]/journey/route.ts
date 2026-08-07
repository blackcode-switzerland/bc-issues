// GET  /api/workspaces/{ws}/prospects/{n}/journey — the deal ladder
// POST /api/workspaces/{ws}/prospects/{n}/journey — add a step
//
// **POST here does NOT move the deal.** Moving it is
// `POST …/prospects/{n}/stage`, which writes the step AND sets the column. This
// route records a step that did not move it: the `upcoming` rungs the mockup
// renders ahead of where a deal actually is, and a retroactive note about a
// stage that was passed through before the record existed.
//
// Two routes rather than one with a flag, because a flag defaulting to "also
// move the deal" is a second, undocumented way to change a prospect's stage.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import {
  addStageEntry,
  listStageEntries,
  prospectIdBySeq,
} from '@/lib/db/queries/prospect-children'
import { publicJourneyStep } from '@/lib/views'
import { requireNumberParam, requireStage, str } from '@/lib/http-input'
import { STAGE_ENTRY_STATUS_VALUES } from '@/lib/pipeline'

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
  return jsonList((await listStageEntries(prospectId)).map(publicJourneyStep), null)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const prospectId = await requireProspect(ctx.workspace.id, n)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const stage = str(body?.stage)
  if (!stage) {
    throw Errors.badRequest(
      'missing_stage',
      'stage is required',
      'run `bk meta` for the current stage values'
    )
  }
  requireStage(stage)

  const status = str(body?.status)
  if (status && !STAGE_ENTRY_STATUS_VALUES.includes(status)) {
    throw Errors.badRequest(
      'unknown_status',
      `unknown journey status ${JSON.stringify(status)}`,
      'run `bk meta` for the current values'
    )
  }

  const occurredRaw = str(body?.occurred_at)
  const occurredAt = occurredRaw ? new Date(occurredRaw) : undefined
  if (occurredAt && Number.isNaN(occurredAt.getTime())) {
    throw Errors.badRequest(
      'invalid_occurred_at',
      `occurred_at is not a timestamp: ${JSON.stringify(occurredRaw)}`,
      'pass an ISO 8601 timestamp, e.g. 2026-08-07T14:00:00Z'
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await addStageEntry(
    ctx.workspace.id,
    prospectId,
    { stage, status, note: str(body?.note) ?? null, occurredAt },
    actor
  )
  return NextResponse.json(publicJourneyStep(row), { status: 201 })
})
