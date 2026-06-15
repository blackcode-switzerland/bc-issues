// Legacy /api/projects/[id] — kept for the existing dashboard UI. Uses the
// new workspace-aware query layer. Permission gating is workspace membership.
// New code should call /api/workspaces/[ws]/projects/[id] directly.

import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import {
  deleteProject,
  getProject,
  updateProject,
} from '@/lib/db/queries/projects'
import { getMembership } from '@/lib/db/queries/workspaces'
import type { DeleteMode } from '@/lib/db/queries/deletion'

interface Params {
  params: Promise<{ id: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const user = await resolveUser(req)
  if (!user) throw Errors.unauthorized()
  const { id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')

  const project = await getProject(id)
  if (!project || !project.workspace_id) throw Errors.notFound('project')
  const membership = await getMembership(project.workspace_id, user.id)
  if (!membership) throw Errors.notFound('project')

  return NextResponse.json(project)
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const user = await resolveUser(req)
  if (!user) throw Errors.unauthorized()
  const { id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')

  const project = await getProject(id)
  if (!project || !project.workspace_id) throw Errors.notFound('project')
  const membership = await getMembership(project.workspace_id, user.id)
  if (!membership) throw Errors.notFound('project')

  const body = await req.json()
  const updated = await updateProject(project.workspace_id, id, body, user.id)
  if (!updated) throw Errors.notFound('project')
  return NextResponse.json(updated)
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const user = await resolveUser(req)
  if (!user) throw Errors.unauthorized()
  const { id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')

  const project = await getProject(id)
  if (!project || !project.workspace_id) throw Errors.notFound('project')
  const membership = await getMembership(project.workspace_id, user.id)
  if (!membership) throw Errors.notFound('project')

  const mode: DeleteMode = req.nextUrl.searchParams.get('mode') === 'cascade' ? 'cascade' : 'detach'
  await deleteProject(project.workspace_id, id, user.id, mode)
  return NextResponse.json({ success: true })
})
