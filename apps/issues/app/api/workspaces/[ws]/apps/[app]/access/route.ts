// Per-member access to one app.
//
//   GET  — every member of the workspace, flagged with whether they hold access.
//          Readable by any member: "why can Ana see this and I can't" should be
//          answerable without asking an owner.
//   POST — grant access to one member. Owner only. Body: { user_id }
//
// Revoking is DELETE on ./[userId]/route.ts.

import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, requireOwner, jsonList } from '@/lib/api'
import { db } from '@/lib/db/client'
import { recordEvent } from '@/lib/db/queries/events'
import { getMembership } from '@/lib/db/queries/workspaces'
import { getWorkspaceApp, grantAppAccess, listAppAccessMembers } from '@blackcode/platform-db'

interface Params {
  params: Promise<{ ws: string; app: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, app } = await params
  const ctx = await resolveWorkspace(req, ws)
  return jsonList(await listAppAccessMembers(db, ctx.workspace.id, app))
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, app } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  const body = await req.json().catch(() => null)
  const userId = typeof body?.user_id === 'number' ? body.user_id : NaN
  if (!Number.isInteger(userId)) {
    throw Errors.badRequest(
      'invalid_user_id',
      'user_id (integer) is required',
      'Run `bk member list` to see user ids in this workspace.'
    )
  }

  // The app must be on here, or a grant would be a row nothing honours.
  const wsApp = await getWorkspaceApp(db, ctx.workspace.id, app)
  if (!wsApp) {
    throw Errors.badRequest(
      'app_not_enabled',
      `The ${app} app is not enabled for this workspace.`,
      `Enable it first: bk app enable ${app} --ws ${ctx.workspace.slug}`
    )
  }

  // Access requires membership — the app_access FK enforces that too, but a 409
  // saying so beats a raw FK violation.
  const membership = await getMembership(ctx.workspace.id, userId)
  if (!membership) {
    throw Errors.conflict(
      'not_a_member',
      'That user is not a member of this workspace.',
      `Invite them first: bk invite create --email <email> --app ${app}`
    )
  }

  await db.transaction(async (tx) => {
    await grantAppAccess(
      tx,
      { app, workspaceId: ctx.workspace.id, userId },
      { role: membership.role, grantedBy: ctx.user.id }
    )
    await recordEvent(tx, {
      workspaceId: ctx.workspace.id,
      actorUserId: ctx.user.id,
      entityType: 'workspace_app',
      entityId: ctx.workspace.id,
      action: 'app_access_granted',
      meta: { app, user_id: userId },
    })
  })

  return NextResponse.json({ app, user_id: userId, granted: true }, { status: 201 })
})
