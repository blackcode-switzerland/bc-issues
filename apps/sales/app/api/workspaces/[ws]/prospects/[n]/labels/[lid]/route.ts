// DELETE /api/workspaces/{ws}/prospects/{n}/labels/{lid} — detach a label
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { detachLabel } from '@/lib/db/queries/labels'
import { getProspectBySeq } from '@/lib/db/queries/prospects'
import { requireNumberParam } from '@/lib/http-input'

interface Params {
  params: Promise<{ ws: string; n: string; lid: string }>
}

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n, lid } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'prospect')
  const row = await getProspectBySeq(ctx.workspace.id, seq)
  if (!row) {
    throw Errors.notFound(
      'prospect_not_found',
      `no prospect #${seq} in this workspace`,
      'run `bk sales prospect list --q <name>` to find it'
    )
  }
  const labelId = Number(lid)
  if (!Number.isInteger(labelId) || labelId <= 0) {
    throw Errors.notFound(
      'label_not_found',
      `${JSON.stringify(lid)} is not a label id`,
      `run \`bk sales prospect show ${seq}\` to see which labels it carries`
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const removed = await detachLabel(ctx.workspace.id, row.id, labelId, actor)
  if (!removed) {
    throw Errors.notFound(
      'label_not_attached',
      `label ${labelId} is not on prospect #${seq}`,
      `run \`bk sales prospect show ${seq}\` to see which labels it carries`
    )
  }
  return NextResponse.json({ deleted: true, type: 'label_attachment', label_id: labelId })
})
