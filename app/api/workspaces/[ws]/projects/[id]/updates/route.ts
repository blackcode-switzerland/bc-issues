import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace } from '@/lib/api'
import {
  PROJECT_UPDATE_STATUSES,
  createProjectUpdate,
  listProjectUpdates,
  verifyProjectInWorkspace,
  type ProjectUpdateStatus,
} from '@/lib/db/queries/project-updates'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')
  const ctx = await resolveWorkspace(req, ws)
  if (!(await verifyProjectInWorkspace(ctx.workspace.id, id))) {
    throw Errors.notFound('project')
  }
  const data = await listProjectUpdates(id)
  return NextResponse.json({ data })
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')
  const ctx = await resolveWorkspace(req, ws)
  if (!(await verifyProjectInWorkspace(ctx.workspace.id, id))) {
    throw Errors.notFound('project')
  }

  const body = await req.json().catch(() => null)
  const status = typeof body?.status === 'string' ? body.status : ''
  if (!PROJECT_UPDATE_STATUSES.includes(status as ProjectUpdateStatus)) {
    throw Errors.badRequest('invalid_status', 'status must be on_track, at_risk or off_track')
  }
  const rawBody = typeof body?.body === 'string' ? body.body.trim() : ''

  const update = await createProjectUpdate({
    workspaceId: ctx.workspace.id,
    projectId: id,
    userId: ctx.user.id,
    status: status as ProjectUpdateStatus,
    body: rawBody || null,
  })
  return NextResponse.json(update, { status: 201 })
})
