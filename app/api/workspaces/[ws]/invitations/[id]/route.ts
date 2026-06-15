import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, requireOwner } from '@/lib/api'
import { revokeInvitation } from '@/lib/db/queries/invitations'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idRaw } = await params
  const id = parseInt(idRaw)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')

  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  const ok = await revokeInvitation(id, ctx.workspace.id, ctx.user.id)
  if (!ok) {
    throw Errors.notFound('invitation')
  }
  return NextResponse.json({ revoked: true })
})
