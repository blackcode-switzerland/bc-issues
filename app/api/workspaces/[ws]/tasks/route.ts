import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, resolveEntityId, jsonList, publicTask } from '@/lib/api'
import {
  createTask,
  getTaskInWorkspace,
  listTasksInWorkspace,
} from '@/lib/db/queries/tasks'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const sp = req.nextUrl.searchParams

  // project_id filter is a workspace #number (seq); 'null' = standalone tasks.
  let projectId: number | null | undefined
  const raw = sp.get('project_id')
  if (raw === 'null') projectId = null
  else if (raw) projectId = await resolveEntityId(ctx.workspace.id, 'project', raw)

  const data = await listTasksInWorkspace(ctx.workspace.id, {
    projectId,
    search: sp.get('search') ?? undefined,
  })
  return jsonList(data.map(publicTask))
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) throw Errors.badRequest('invalid_name', 'name is required')
  if (name.length > 100) throw Errors.badRequest('name_too_long', 'name max 100 chars')

  // project_id is a workspace #number (seq) → resolve to the internal id.
  let projectId: number | null = null
  if (body.project_id != null) {
    if (typeof body.project_id !== 'number') {
      throw Errors.badRequest('invalid_project_id', 'project_id must be an integer or null')
    }
    projectId = await resolveEntityId(ctx.workspace.id, 'project', String(body.project_id))
  }

  const task = await createTask({
    workspaceId: ctx.workspace.id,
    projectId,
    name,
    description: typeof body.description === 'string' ? body.description : null,
    due_date: typeof body.due_date === 'string' ? body.due_date : null,
    lead_user_id: typeof body.lead_user_id === 'number' ? body.lead_user_id : ctx.user.id,
    actorUserId: ctx.user.id,
  })
  // Re-fetch the joined row so project_id (FK) serializes to the project seq.
  const full = await getTaskInWorkspace(ctx.workspace.id, task.id)
  return NextResponse.json(publicTask(full ?? task), { status: 201 })
})
