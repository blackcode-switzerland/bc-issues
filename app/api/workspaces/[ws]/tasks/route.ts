import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, jsonList } from '@/lib/api'
import {
  createTask,
  listTasksInWorkspace,
} from '@/lib/db/queries/tasks'
import { getProjectInWorkspace } from '@/lib/db/queries/projects'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const sp = req.nextUrl.searchParams

  let projectId: number | null | undefined
  const raw = sp.get('project_id')
  if (raw === 'null') projectId = null
  else if (raw) {
    const n = parseInt(raw)
    if (Number.isNaN(n)) throw Errors.badRequest('invalid_project_id', 'project_id must be integer or "null"')
    projectId = n
  }

  const data = await listTasksInWorkspace(ctx.workspace.id, {
    projectId,
    search: sp.get('search') ?? undefined,
  })
  return jsonList(data)
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

  let projectId: number | null = null
  if (body.project_id != null) {
    if (typeof body.project_id !== 'number') {
      throw Errors.badRequest('invalid_project_id', 'project_id must be an integer or null')
    }
    const proj = await getProjectInWorkspace(ctx.workspace.id, body.project_id)
    if (!proj) throw Errors.notFound('project')
    projectId = body.project_id
  }

  const task = await createTask({
    workspaceId: ctx.workspace.id,
    projectId,
    name,
    description: typeof body.description === 'string' ? body.description : null,
    due_date: typeof body.due_date === 'string' ? body.due_date : null,
    actorUserId: ctx.user.id,
  })
  return NextResponse.json(task, { status: 201 })
})
