// Workspace-scoped request context.
//
// Every workspace-scoped API route resolves the user + workspace + membership
// up front via resolveWorkspace(). It throws the right ApiError on each gate:
//   - no auth                    → 401 unauthorized
//   - workspace not found OR     → 404 workspace_not_found
//     user is not a member         (we return 404, not 403, so we don't leak
//                                   the existence of workspaces the user can't
//                                   see)
//   - owner-only action and      → 403 forbidden
//     caller is not the owner
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
import { Errors } from './errors'

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
