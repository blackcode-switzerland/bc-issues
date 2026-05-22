// Legacy /api/projects — kept for the existing dashboard UI. Uses the active
// workspace to scope the query. New code should call
// /api/workspaces/[ws]/projects directly.

import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { getUserById } from '@/lib/db/queries/users'
import {
  createProject,
  listProjectsInWorkspace,
  pageProjectsInWorkspace,
} from '@/lib/db/queries/projects'
import { getMembership } from '@/lib/db/queries/workspaces'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

async function activeWorkspaceFor(userId: number) {
  const user = await getUserById(userId)
  if (!user) return null
  return user.active_workspace_id ?? null
}

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()

  const workspaceId = await activeWorkspaceFor(user.id)
  if (!workspaceId) {
    // No active workspace yet — return empty.
    return NextResponse.json([])
  }
  const membership = await getMembership(workspaceId, user.id)
  if (!membership) {
    return NextResponse.json([])
  }

  const sp = request.nextUrl.searchParams
  const rawLimit = sp.get('limit')
  const rawCursor = sp.get('cursor')

  if (rawLimit !== null || rawCursor !== null) {
    let limit = DEFAULT_LIMIT
    if (rawLimit !== null) {
      const n = parseInt(rawLimit)
      if (!Number.isNaN(n) && n >= 1) limit = Math.min(n, MAX_LIMIT)
    }
    let cursor: number | null = null
    if (rawCursor !== null) {
      const n = parseInt(rawCursor)
      cursor = Number.isNaN(n) ? null : n
    }
    const result = await pageProjectsInWorkspace({ workspaceId, limit, cursor })
    return NextResponse.json(result)
  }

  const data = await listProjectsInWorkspace(workspaceId)
  return NextResponse.json(data)
})

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()

  const workspaceId = await activeWorkspaceFor(user.id)
  if (!workspaceId) {
    throw Errors.conflict(
      'no_active_workspace',
      'Set an active workspace first via POST /api/me/active-workspace'
    )
  }
  const membership = await getMembership(workspaceId, user.id)
  if (!membership) throw Errors.forbidden('You are not a member of the active workspace')

  const body = await request.json()
  const { name, description } = body
  if (!name || typeof name !== 'string' || name.length > 100) {
    throw Errors.badRequest('invalid_name', 'Name is required, max 100 chars')
  }

  const project = await createProject({
    workspaceId,
    name,
    description: description ?? null,
    actorUserId: user.id,
  })
  return NextResponse.json(project, { status: 201 })
})
