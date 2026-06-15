// Legacy /api/issues — resolves the user's active workspace for listings,
// and forwards mutations to the workspace-aware queries.

import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { getUserById } from '@/lib/db/queries/users'
import {
  createIssue,
  listIssuesInWorkspace,
} from '@/lib/db/queries/issues'
import { getMembership, getWorkspaceForUser } from '@/lib/db/queries/workspaces'
import { getProjectInWorkspace } from '@/lib/db/queries/projects'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

async function resolveActiveWorkspace(userId: number) {
  const u = await getUserById(userId)
  if (!u?.active_workspace_id) return null
  return await getWorkspaceForUser(String(u.active_workspace_id), userId)
}

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()

  const ws = await resolveActiveWorkspace(user.id)
  if (!ws) return NextResponse.json([])

  const sp = request.nextUrl.searchParams
  const projectIdRaw = sp.get('project_id')
  let projectId: number | undefined
  if (projectIdRaw) {
    const n = parseInt(projectIdRaw)
    if (Number.isNaN(n)) throw Errors.badRequest('invalid_project_id', 'project_id must be an integer')
    projectId = n
  }

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
    const result = await listIssuesInWorkspace(ws.id, { projectId, limit, cursor })
    return NextResponse.json(result)
  }

  const data = await listIssuesInWorkspace(ws.id, { projectId, limit: MAX_LIMIT })
  return NextResponse.json(data.data)
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
  const { project_id, title, description, status, priority, assignee_id, assignee_ids, milestone_id } = body

  if (!title || typeof title !== 'string') {
    throw Errors.badRequest('invalid_title', 'title is required')
  }
  if (title.length > 200) {
    throw Errors.badRequest('title_too_long', 'title max 200 chars')
  }

  let projectId: number | null = null
  if (project_id != null) {
    if (typeof project_id !== 'number') {
      throw Errors.badRequest('invalid_project_id', 'project_id must be an integer or null')
    }
    const proj = await getProjectInWorkspace(ws.id, project_id)
    if (!proj) throw Errors.notFound('project')
    projectId = project_id
  }

  try {
    const issue = await createIssue({
      workspaceId: ws.id,
      projectId,
      milestoneId: typeof milestone_id === 'number' ? milestone_id : null,
      title,
      description: description ?? null,
      status: status ?? undefined,
      priority: typeof priority === 'number' ? priority : undefined,
      assigneeIds: Array.isArray(assignee_ids)
        ? assignee_ids.filter((v: unknown): v is number => typeof v === 'number')
        : typeof assignee_id === 'number'
          ? [assignee_id]
          : [],
      reporterId: user.id,
      actorUserId: user.id,
    })
    return NextResponse.json(issue, { status: 201 })
  } catch (err) {
    const m = (err as Error)?.message
    if (m === 'invalid_status') throw Errors.badRequest('invalid_status', 'invalid status value')
    if (m === 'invalid_priority') throw Errors.badRequest('invalid_priority', 'priority must be 1-5')
    throw err
  }
})
