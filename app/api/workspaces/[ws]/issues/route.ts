import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace } from '@/lib/api'
import {
  createIssue,
  listIssuesInWorkspace,
} from '@/lib/db/queries/issues'
import { getMembership } from '@/lib/db/queries/workspaces'
import { getProjectInWorkspace } from '@/lib/db/queries/projects'

interface Params {
  params: Promise<{ ws: string }>
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function parseNullableInt(raw: string | null, name: string): number | null | undefined {
  if (raw === null) return undefined
  if (raw === 'null') return null
  const n = parseInt(raw)
  if (Number.isNaN(n)) throw Errors.badRequest(`invalid_${name}`, `${name} must be integer or "null"`)
  return n
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const sp = req.nextUrl.searchParams

  const limitRaw = sp.get('limit')
  let limit = DEFAULT_LIMIT
  if (limitRaw !== null) {
    const n = parseInt(limitRaw)
    if (!Number.isNaN(n) && n >= 1) limit = Math.min(n, MAX_LIMIT)
  }
  const cursorRaw = sp.get('cursor')
  let cursor: number | null = null
  if (cursorRaw !== null) {
    const n = parseInt(cursorRaw)
    cursor = Number.isNaN(n) ? null : n
  }

  // Assignee filter: ?assignee_id=null (unassigned), ?assignee_id=1 (single),
  // or ?assignee_ids=1&assignee_ids=2 (multi). assignee_id is kept for
  // backward compatibility with the CLI and any external integrations.
  let assigneeIds: number[] | null | undefined
  const assigneeIdRaw = sp.get('assignee_id')
  const assigneeIdsRaw = sp.getAll('assignee_ids')
  if (assigneeIdsRaw.length > 0) {
    assigneeIds = assigneeIdsRaw.map(Number).filter((n) => !Number.isNaN(n))
  } else if (assigneeIdRaw === 'null') {
    assigneeIds = null
  } else if (assigneeIdRaw !== null) {
    const n = parseInt(assigneeIdRaw)
    if (!Number.isNaN(n)) assigneeIds = [n]
  }

  const page = await listIssuesInWorkspace(ctx.workspace.id, {
    projectId: parseNullableInt(sp.get('project_id'), 'project_id'),
    milestoneId: parseNullableInt(sp.get('milestone_id'), 'milestone_id'),
    assigneeIds,
    status: sp.get('status') ?? undefined,
    priority: sp.get('priority') ? parseInt(sp.get('priority')!) || undefined : undefined,
    search: sp.get('search') ?? undefined,
    limit,
    cursor,
  })
  return NextResponse.json(page)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) throw Errors.badRequest('invalid_title', 'title is required')
  if (title.length > 200) throw Errors.badRequest('title_too_long', 'title max 200 chars')

  let projectId: number | null = null
  if (body.project_id != null) {
    if (typeof body.project_id !== 'number') {
      throw Errors.badRequest('invalid_project_id', 'project_id must be an integer or null')
    }
    const proj = await getProjectInWorkspace(ctx.workspace.id, body.project_id)
    if (!proj) throw Errors.notFound('project')
    projectId = body.project_id
  }

  // Accept assignee_ids (preferred) or legacy assignee_id (single).
  const rawAssigneeIds: number[] = []
  if (Array.isArray(body.assignee_ids)) {
    for (const v of body.assignee_ids) {
      if (typeof v !== 'number') throw Errors.badRequest('invalid_assignee_ids', 'assignee_ids must be an array of integers')
      rawAssigneeIds.push(v)
    }
  } else if (body.assignee_id != null) {
    if (typeof body.assignee_id !== 'number') {
      throw Errors.badRequest('invalid_assignee_id', 'assignee_id must be an integer or null')
    }
    rawAssigneeIds.push(body.assignee_id)
  }
  // Validate each assignee is a workspace member.
  for (const uid of rawAssigneeIds) {
    const member = await getMembership(ctx.workspace.id, uid)
    if (!member) throw Errors.badRequest('assignee_not_member', `User ${uid} is not a workspace member`)
  }

  const labelIds = Array.isArray(body.label_ids)
    ? body.label_ids.filter((n: unknown): n is number => typeof n === 'number')
    : undefined

  try {
    const issue = await createIssue({
      workspaceId: ctx.workspace.id,
      title,
      description: typeof body.description === 'string' ? body.description : null,
      status: typeof body.status === 'string' ? body.status : undefined,
      priority: typeof body.priority === 'number' ? body.priority : undefined,
      assigneeIds: rawAssigneeIds,
      milestoneId: typeof body.milestone_id === 'number' ? body.milestone_id : null,
      projectId,
      startDate: typeof body.start_date === 'string' ? body.start_date : null,
      dueDate: typeof body.due_date === 'string' ? body.due_date : null,
      estimatedHours: typeof body.estimated_hours === 'number' ? body.estimated_hours : null,
      labelIds,
      reporterId: ctx.user.id,
      actorUserId: ctx.user.id,
    })
    return NextResponse.json(issue, { status: 201 })
  } catch (err) {
    const m = (err as Error)?.message
    if (m === 'invalid_status') throw Errors.badRequest('invalid_status', 'invalid status value')
    if (m === 'invalid_priority') throw Errors.badRequest('invalid_priority', 'priority must be 1-5')
    throw err
  }
})
