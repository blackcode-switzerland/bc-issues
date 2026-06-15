// Legacy /api/milestones — wraps the workspace-aware queries using the user's
// active workspace. Use /api/workspaces/[ws]/milestones for the canonical path.

import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { getUserById } from '@/lib/db/queries/users'
import {
  createMilestone,
  listMilestonesInWorkspace,
} from '@/lib/db/queries/milestones'
import { getMembership, getWorkspaceForUser } from '@/lib/db/queries/workspaces'
import { getProjectInWorkspace } from '@/lib/db/queries/projects'

async function resolveActiveWorkspace(userId: number) {
  const user = await getUserById(userId)
  if (!user?.active_workspace_id) return null
  const ws = await getWorkspaceForUser(String(user.active_workspace_id), userId)
  return ws
}

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()

  const ws = await resolveActiveWorkspace(user.id)
  if (!ws) return NextResponse.json([])

  const projectIdParam = request.nextUrl.searchParams.get('project_id')
  let projectId: number | undefined
  if (projectIdParam) {
    const n = parseInt(projectIdParam)
    if (Number.isNaN(n)) throw Errors.badRequest('invalid_project_id', 'project_id must be an integer')
    projectId = n
  }

  const data = await listMilestonesInWorkspace(ws.id, { projectId })
  return NextResponse.json(data)
})

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()

  const ws = await resolveActiveWorkspace(user.id)
  if (!ws) {
    throw Errors.conflict(
      'no_active_workspace',
      'Set an active workspace first via POST /api/me/active-workspace'
    )
  }
  const membership = await getMembership(ws.id, user.id)
  if (!membership) throw Errors.forbidden('You are not a member of the active workspace')

  const body = await request.json()
  const { project_id, name, description, due_date } = body
  if (!name) throw Errors.badRequest('invalid_name', 'name is required')

  // If project_id is provided, verify it belongs to this workspace.
  if (project_id != null) {
    if (typeof project_id !== 'number') {
      throw Errors.badRequest('invalid_project_id', 'project_id must be an integer or null')
    }
    const proj = await getProjectInWorkspace(ws.id, project_id)
    if (!proj) throw Errors.notFound('project')
  }

  const milestone = await createMilestone({
    workspaceId: ws.id,
    projectId: project_id ?? null,
    name,
    description: description ?? null,
    due_date: due_date ?? null,
    actorUserId: user.id,
  })
  return NextResponse.json(milestone, { status: 201 })
})
