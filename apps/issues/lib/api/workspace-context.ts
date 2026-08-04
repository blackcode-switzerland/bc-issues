// Workspace-scoped request context.
//
// Every workspace-scoped API route resolves the user + workspace + membership
// up front via resolveWorkspace(). It throws the right ApiError on each gate:
//   - no auth                    → 401 unauthorized
//   - workspace not found OR     → 404 workspace_not_found
//     user is not a member         (we return 404, not 403, so we don't leak
//                                   the existence of workspaces the user can't
//                                   see)
//   - member, but no access to    → 403 app_access_denied, WITH a suggestion
//     THIS app here                naming who can grant it (Phase 4)
//   - owner-only action and      → 403 forbidden
//     caller is not the owner
//
// The two 403s are different failures and the distinction matters: "you are not
// the owner" is final, while "you don't have the app here" is grantable, so it
// carries a hint. 403 rather than 404 for app access is deliberate — the caller
// IS a member, so hiding the workspace would hide the one fact they need.
//
// The returned context object is meant to be passed to the query layer:
//
//   export const GET = apiHandler(async (req, { params }) => {
//     const ctx = await resolveWorkspace(req, params.ws)
//     return NextResponse.json(await getProjectsInWorkspace(ctx.workspace.id))
//   })

import type { NextRequest } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { getWorkspaceForUser } from '@/lib/db/queries/workspaces'
import type { Workspace, User } from '@/lib/db/schema'
import { db } from '@/lib/db/client'
import { APP_SLUG } from '@/lib/app'
import { Errors } from '@blackcode/platform-api'
import { requireAppAccess } from '@blackcode/platform-auth'

export interface WorkspaceContext {
  user: User
  workspace: Workspace
  role: 'owner' | 'member'
}

export async function resolveWorkspace(
  req: NextRequest,
  slugOrId: string
): Promise<WorkspaceContext> {
  const user = await resolveUser(req)
  if (!user) throw Errors.unauthorized()

  if (!slugOrId) throw Errors.notFound('workspace')

  const ws = await getWorkspaceForUser(slugOrId, user.id)
  if (!ws) throw Errors.notFound('workspace')

  // Membership gets you into the organisation; this gets you into THIS app.
  // Behind PLATFORM_ENFORCE_APP_ACCESS — unset means enforced.
  await requireAppAccess(db, {
    app: APP_SLUG,
    workspaceId: ws.id,
    userId: user.id,
    userEmail: user.email,
    workspaceSlug: ws.slug,
  })

  return {
    user,
    workspace: ws,
    role: ws.member_role,
  }
}

export function requireOwner(ctx: WorkspaceContext): void {
  if (ctx.role !== 'owner') {
    throw Errors.forbidden('Only the workspace owner can perform this action')
  }
}
