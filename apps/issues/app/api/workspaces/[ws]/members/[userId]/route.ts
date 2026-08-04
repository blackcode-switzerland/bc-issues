import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, requireOwner } from '@/lib/api'
import { removeMember } from '@/lib/db/queries/workspaces'

interface Params {
  params: Promise<{ ws: string; userId: string }>
}

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, userId: userIdRaw } = await params
  const targetId = parseInt(userIdRaw)
  if (Number.isNaN(targetId)) {
    throw Errors.badRequest('invalid_user_id', 'userId must be an integer')
  }

  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  if (targetId === ctx.workspace.owner_id) {
    throw Errors.badRequest(
      'cannot_remove_owner',
      'Transfer ownership before removing the owner'
    )
  }

  const ok = await removeMember(ctx.workspace.id, targetId, ctx.user.id)
  if (!ok) throw Errors.notFound('member')
  return NextResponse.json({ removed: true })
})
