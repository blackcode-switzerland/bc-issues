import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, requireOwner } from '@/lib/api'
import { getUserByEmail } from '@/lib/db/queries/users'
import { transferOwnership } from '@/lib/db/queries/workspaces'

interface Params {
  params: Promise<{ ws: string }>
}

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }

  let targetUserId: number | null = null
  if (typeof body.new_owner_user_id === 'number') {
    targetUserId = body.new_owner_user_id
  } else if (typeof body.new_owner_email === 'string') {
    const u = await getUserByEmail(body.new_owner_email.trim())
    if (!u) throw Errors.notFound('user')
    targetUserId = u.id
  }
  if (!targetUserId) {
    throw Errors.badRequest(
      'missing_target',
      'provide new_owner_user_id or new_owner_email'
    )
  }

  if (targetUserId === ctx.user.id) {
    throw Errors.badRequest('already_owner', 'you are already the owner')
  }

  try {
    await transferOwnership(ctx.workspace.id, targetUserId, ctx.user.id)
  } catch (err) {
    const message = (err as Error)?.message
    if (message === 'not_a_member') {
      throw Errors.badRequest('not_a_member', 'target user is not a member of this workspace')
    }
    if (message === 'workspace_not_found') throw Errors.notFound('workspace')
    throw err
  }

  return NextResponse.json({ ok: true, new_owner_user_id: targetUserId })
})
