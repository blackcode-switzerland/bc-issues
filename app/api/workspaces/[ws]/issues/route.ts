import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, resolveEntityId, publicIssue } from '@/lib/api'
import {
  createIssue,
  getIssueInWorkspace,
  listIssuesInWorkspace,
} from '@/lib/db/queries/issues'
import { getMembership } from '@/lib/db/queries/workspaces'

interface Params {
  params: Promise<{ ws: string }>
}

// project_id / task_id query params are workspace #numbers (seq). 'null' filters
// for unscoped issues; absent = no filter. Returns the internal id to filter on.
async function seqFilter(
  workspaceId: number,
  type: 'project' | 'task',
  raw: string | null
): Promise<number | null | undefined> {
  if (raw === null) return undefined
  if (raw === 'null') return null
  return resolveEntityId(workspaceId, type, raw)
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const sp = req.nextUrl.searchParams

  // Assignee filter: ?assignee_id=null (unassigned), ?assignee_id=1 (single),
  // or ?assignee_ids=1&assignee_ids=2 (multi). Assignees are user ids.
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
    projectId: await seqFilter(ctx.workspace.id, 'project', sp.get('project_id')),
    taskId: await seqFilter(ctx.workspace.id, 'task', sp.get('task_id')),
    assigneeIds,
    status: sp.get('status') ?? undefined,
    priority: sp.get('priority') ? parseInt(sp.get('priority')!) || undefined : undefined,
    search: sp.get('search') ?? undefined,
  })
  return NextResponse.json({ data: page.data.map(publicIssue), total: page.total })
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

  // project_id / task_id in the body are workspace #numbers (seq) → resolve to
  // the internal id (also validates they exist in this workspace).
  let projectId: number | null = null
  if (body.project_id != null) {
    if (typeof body.project_id !== 'number') {
      throw Errors.badRequest('invalid_project_id', 'project_id must be an integer or null')
    }
    projectId = await resolveEntityId(ctx.workspace.id, 'project', String(body.project_id))
  }
  let taskId: number | null = null
  if (body.task_id != null) {
    if (typeof body.task_id !== 'number') {
      throw Errors.badRequest('invalid_task_id', 'task_id must be an integer or null')
    }
    taskId = await resolveEntityId(ctx.workspace.id, 'task', String(body.task_id))
  }

  // Accept assignee_ids (preferred) or legacy assignee_id (single). User ids.
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
  for (const uid of rawAssigneeIds) {
    const member = await getMembership(ctx.workspace.id, uid)
    if (!member) throw Errors.badRequest('assignee_not_member', `User ${uid} is not a workspace member`)
  }

  // Labels: existing ids via label_ids, and/or names via labels. Label ids are
  // their own (workspace-scoped) ids, not seq.
  let labelIds: number[] | undefined
  if (body.label_ids !== undefined) {
    if (!Array.isArray(body.label_ids) || !body.label_ids.every((n: unknown) => typeof n === 'number')) {
      throw Errors.badRequest(
        'invalid_label_ids',
        'label_ids must be an array of integers; pass label names via "labels" to use or create them by name'
      )
    }
    labelIds = body.label_ids
  }
  let labelNames: string[] | undefined
  if (body.labels !== undefined) {
    if (!Array.isArray(body.labels) || !body.labels.every((s: unknown) => typeof s === 'string')) {
      throw Errors.badRequest('invalid_labels', 'labels must be an array of label-name strings')
    }
    const names = (body.labels as string[]).map((s) => s.trim()).filter(Boolean)
    for (const n of names) {
      if (n.length > 50) throw Errors.badRequest('label_name_too_long', 'label names are max 50 chars')
    }
    labelNames = names
  }

  try {
    const created = await createIssue({
      workspaceId: ctx.workspace.id,
      title,
      description: typeof body.description === 'string' ? body.description : null,
      status: typeof body.status === 'string' ? body.status : undefined,
      priority: typeof body.priority === 'number' ? body.priority : undefined,
      assigneeIds: rawAssigneeIds,
      taskId,
      projectId,
      startDate: typeof body.start_date === 'string' ? body.start_date : null,
      dueDate: typeof body.due_date === 'string' ? body.due_date : null,
      estimatedHours: typeof body.estimated_hours === 'number' ? body.estimated_hours : null,
      labelIds,
      labelNames,
      reporterId: ctx.user.id,
      actorUserId: ctx.user.id,
    })
    // Re-fetch the joined row so the response carries parent seqs for FK fields.
    const full = await getIssueInWorkspace(ctx.workspace.id, created.id)
    return NextResponse.json(publicIssue(full ?? created), { status: 201 })
  } catch (err) {
    const m = (err as Error)?.message
    if (m === 'invalid_status') throw Errors.badRequest('invalid_status', 'invalid status value')
    if (m === 'invalid_priority') throw Errors.badRequest('invalid_priority', 'priority must be 1-5')
    throw err
  }
})
