import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, resolveWorkspace, requireOwner } from '@/lib/api'
import { listInviteCandidates } from '@/lib/db/queries/invite-candidates'
import { isSuperAdmin } from '@/lib/auth/whitelist'

interface Params {
  params: Promise<{ ws: string }>
}

// People the owner can invite without retyping an email: members of their other
// workspaces, plus (for super admins) every platform user. Owner-only, same gate
// as POST /invitations.
export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  const includePlatform = isSuperAdmin(ctx.user.email)
  const data = await listInviteCandidates({
    userId: ctx.user.id,
    currentWorkspaceId: ctx.workspace.id,
    includePlatform,
  })

  return NextResponse.json({ data, is_super_admin: includePlatform })
})
