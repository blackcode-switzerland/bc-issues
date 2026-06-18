import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace } from '@/lib/api'
import {
  deleteTask,
  getTaskInWorkspace,
  updateTask,
} from '@/lib/db/queries/tasks'
import { getIssuesByTask } from '@/lib/db/queries/issues'
import { getProjectInWorkspace } from '@/lib/db/queries/projects'
import { previewDeletion, type DeleteMode } from '@/lib/db/queries/deletion'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')
  const ctx = await resolveWorkspace(req, ws)

  if (req.nextUrl.searchParams.get('preview')) {
    const counts = await previewDeletion(ctx.workspace.id, 'task', id)
    return NextResponse.json(counts)
  }

  const m = await getTaskInWorkspace(ctx.workspace.id, id)
  if (!m) throw Errors.notFound('task')

  if (req.nextUrl.searchParams.get('includeIssues') === 'true') {
    const issues = await getIssuesByTask(id)
    return NextResponse.json({ ...m, issues })
  }
  return NextResponse.json(m)
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')
  const ctx = await resolveWorkspace(req, ws)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }

  // If project_id is changing, verify it belongs to this workspace (or is null).
  if ('project_id' in body) {
    if (body.project_id !== null) {
      if (typeof body.project_id !== 'number') {
        throw Errors.badRequest('invalid_project_id', 'project_id must be an integer or null')
      }
      const proj = await getProjectInWorkspace(ctx.workspace.id, body.project_id)
      if (!proj) throw Errors.notFound('project')
    }
  }

  const updated = await updateTask(ctx.workspace.id, id, body, ctx.user.id)
  if (!updated) throw Errors.notFound('task')
  return NextResponse.json(updated)
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')
  const ctx = await resolveWorkspace(req, ws)

  const mode: DeleteMode = req.nextUrl.searchParams.get('mode') === 'cascade' ? 'cascade' : 'detach'
  const ok = await deleteTask(ctx.workspace.id, id, ctx.user.id, mode)
  if (!ok) throw Errors.notFound('task')
  return NextResponse.json({ deleted: true, mode })
})
