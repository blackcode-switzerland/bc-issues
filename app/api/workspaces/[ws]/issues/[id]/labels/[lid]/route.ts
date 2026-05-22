import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace } from '@/lib/api'
import { detachLabel } from '@/lib/db/queries/labels'

interface Params {
  params: Promise<{ ws: string; id: string; lid: string }>
}

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr, lid: lidStr } = await params
  const id = parseInt(idStr)
  const lid = parseInt(lidStr)
  if (Number.isNaN(id) || Number.isNaN(lid)) {
    throw Errors.badRequest('invalid_id', 'id and lid must be integers')
  }
  const ctx = await resolveWorkspace(req, ws)
  const ok = await detachLabel(ctx.workspace.id, id, lid, ctx.user.id)
  if (!ok) throw Errors.notFound('label_or_attachment')
  return NextResponse.json({ detached: true })
})
