// POST /api/workspaces/{ws}/prospects/{n}/stage — move a deal, and write the
//                                                 journey step that proves it
//
// A separate route from `PATCH …/prospects/{n}`, and that is a contract rather
// than a layout choice. Moving a deal does three things at once — the stage
// column, a `sales.stage_entries` row attributed to whoever moved it, and
// `closed_at` / `closed_reason` on a terminal stage. A caller that could set
// `stage` through the generic PATCH would get one of the three, and the
// resulting prospect has a ladder that disagrees with its own stage with nothing
// to say so. The PATCH route refuses `stage` explicitly and names this one.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { getProspectBySeq, setProspectStage } from '@/lib/db/queries/prospects'
import { publicProspect } from '@/lib/views'
import { nullableStr, requireNumberParam, requireStage, str } from '@/lib/http-input'
import { TERMINAL_STAGES } from '@/lib/pipeline'

interface Params {
  params: Promise<{ ws: string; n: string }>
}

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'prospect')
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

  const existing = await getProspectBySeq(ctx.workspace.id, seq)
  if (!existing) {
    throw Errors.notFound(
      'prospect_not_found',
      `no prospect #${seq} in this workspace`,
      'run `bk sales prospect list --q <name>` to find it'
    )
  }
  // Not an error, but not a silent success either: re-posting the stage a deal
  // is already in would otherwise append a second `current` journey row for the
  // same step, and the ladder would show a move that did not happen.
  if (existing.stage === stage) {
    throw Errors.conflict(
      'stage_unchanged',
      `prospect #${seq} is already at stage ${JSON.stringify(stage)}`,
      `run \`bk sales prospect show ${seq}\` for its current stage and journey`
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const moved = await setProspectStage(ctx.workspace.id, seq, stage, {
    note: nullableStr(body?.note) ?? null,
    closedReason: nullableStr(body?.reason) ?? null,
    terminal: TERMINAL_STAGES.includes(stage),
    actor,
  })
  if (!moved) {
    throw Errors.notFound(
      'prospect_not_found',
      `no prospect #${seq} in this workspace`,
      'run `bk sales prospect list --q <name>` to find it'
    )
  }
  return NextResponse.json(publicProspect(moved, ctx.workspace.slug))
})
