// DELETE /api/workspaces/{ws}/apps/{app}/access/{userId} — revoke one member's
// access to one app. Owner only.
//
// Refuses to revoke the workspace OWNER's access, for the same reason
// `cannot_remove_owner` exists on member removal: the owner is the only person
// who can grant it back, and this route is behind the very access check being
// removed. Transfer ownership first if that is genuinely the intent.

import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, requireOwner } from '@/lib/api'
import { db } from '@/lib/db/client'
import { recordEvent } from '@/lib/db/queries/events'
import { revokeAppAccess } from '@blackcode/platform-db'

interface Params {
  params: Promise<{ ws: string; app: string; userId: string }>
}

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, app, userId: userIdRaw } = await params
  const targetId = parseInt(userIdRaw)
  if (Number.isNaN(targetId)) {
    throw Errors.badRequest('invalid_user_id', 'userId must be an integer')
  }

  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  if (targetId === ctx.workspace.owner_id) {
    throw Errors.badRequest(
      'cannot_revoke_owner',
      'The workspace owner cannot have their app access revoked — nobody else could grant it back.',
      'Transfer ownership first with `bk workspace transfer`, then revoke.'
    )
  }

  const revoked = await db.transaction(async (tx) => {
    const ok = await revokeAppAccess(tx, { app, workspaceId: ctx.workspace.id, userId: targetId })
    if (ok) {
      await recordEvent(tx, {
        workspaceId: ctx.workspace.id,
        actorUserId: ctx.user.id,
        entityType: 'workspace_app',
        entityId: ctx.workspace.id,
        action: 'app_access_revoked',
        meta: { app, user_id: targetId },
      })
    }
    return ok
  })

  if (!revoked) throw Errors.notFound('app_access')
  return NextResponse.json({ deleted: true })
})
