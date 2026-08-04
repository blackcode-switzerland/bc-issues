import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, resolveEntityId, publicIssue } from '@/lib/api'
import {
  deleteIssue,
  getIssueInWorkspace,
  updateIssue,
} from '@/lib/db/queries/issues'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'issue', idStr)
  const issue = await getIssueInWorkspace(ctx.workspace.id, id)
  if (!issue) throw Errors.notFound('issue')
  return NextResponse.json(publicIssue(issue))
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'issue', idStr)
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }
  // project_id / task_id are workspace #numbers (seq) → translate to internal ids.
  if ('project_id' in body && body.project_id != null) {
    body.project_id = await resolveEntityId(ctx.workspace.id, 'project', String(body.project_id))
  }
  if ('task_id' in body && body.task_id != null) {
    body.task_id = await resolveEntityId(ctx.workspace.id, 'task', String(body.task_id))
  }
  try {
    const updated = await updateIssue(ctx.workspace.id, id, body, ctx.user.id)
    if (!updated) throw Errors.notFound('issue')
    const full = await getIssueInWorkspace(ctx.workspace.id, id)
    return NextResponse.json(publicIssue(full ?? updated))
  } catch (err) {
    const m = (err as Error)?.message
    if (m === 'invalid_status') throw Errors.badRequest('invalid_status', 'invalid status value')
    if (m === 'invalid_priority') throw Errors.badRequest('invalid_priority', 'priority must be 1-5')
    throw err
  }
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'issue', idStr)
  const ok = await deleteIssue(ctx.workspace.id, id, ctx.user.id)
  if (!ok) throw Errors.notFound('issue')
  return NextResponse.json({ deleted: true })
})
