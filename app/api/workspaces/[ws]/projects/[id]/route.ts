import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace } from '@/lib/api'
import {
  deleteProject,
  getProjectInWorkspace,
  updateProject,
} from '@/lib/db/queries/projects'
import {
  listProjectLabels,
  listProjectMembers,
  setProjectLabels,
  setProjectMembers,
} from '@/lib/db/queries/project-relations'
import { db } from '@/lib/db/client'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')
  const ctx = await resolveWorkspace(req, ws)
  const project = await getProjectInWorkspace(ctx.workspace.id, id)
  if (!project) throw Errors.notFound('project')
  const [members, labels] = await Promise.all([
    listProjectMembers(id),
    listProjectLabels(id),
  ])
  return NextResponse.json({ ...project, members, labels })
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

  // member_ids / label_ids replace the full sets when present.
  if (Array.isArray(body.member_ids)) {
    const ids = body.member_ids.filter((n: unknown): n is number => typeof n === 'number')
    await setProjectMembers(db, id, ids)
  }
  if (Array.isArray(body.label_ids)) {
    const ids = body.label_ids.filter((n: unknown): n is number => typeof n === 'number')
    await setProjectLabels(db, id, ctx.workspace.id, ids)
  }

  const updated = await updateProject(ctx.workspace.id, id, body, ctx.user.id)
  if (!updated) throw Errors.notFound('project')
  const [members, labels] = await Promise.all([
    listProjectMembers(id),
    listProjectLabels(id),
  ])
  return NextResponse.json({ ...updated, members, labels })
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')
  const ctx = await resolveWorkspace(req, ws)
  const ok = await deleteProject(ctx.workspace.id, id, ctx.user.id)
  if (!ok) throw Errors.notFound('project')
  return NextResponse.json({ deleted: true })
})
