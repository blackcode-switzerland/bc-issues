// Legacy /api/issues/[id] — resolves workspace from the issue, verifies
// membership, delegates to the workspace-aware queries.

import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import {
  deleteIssue,
  getIssue,
  getIssueInWorkspace,
  updateIssue,
} from '@/lib/db/queries/issues'
import { getMembership } from '@/lib/db/queries/workspaces'

interface Params {
  params: Promise<{ id: string }>
}

async function loadAndCheck(idStr: string, userId: number) {
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')
  const issue = await getIssue(id)
  if (!issue || !issue.workspace_id) throw Errors.notFound('issue')
  const membership = await getMembership(issue.workspace_id, userId)
  if (!membership) throw Errors.notFound('issue')
  return { id, workspaceId: issue.workspace_id }
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const user = await resolveUser(req)
  if (!user) throw Errors.unauthorized()
  const { id: idStr } = await params
  const { id, workspaceId } = await loadAndCheck(idStr, user.id)
  const issue = await getIssueInWorkspace(workspaceId, id)
  if (!issue) throw Errors.notFound('issue')
  return NextResponse.json(issue)
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const user = await resolveUser(req)
  if (!user) throw Errors.unauthorized()
  const { id: idStr } = await params
  const { id, workspaceId } = await loadAndCheck(idStr, user.id)

  const body = await req.json()
  try {
    const issue = await updateIssue(workspaceId, id, body, user.id)
    if (!issue) throw Errors.notFound('issue')
    return NextResponse.json(issue)
  } catch (err) {
    const m = (err as Error)?.message
    if (m === 'invalid_status') throw Errors.badRequest('invalid_status', 'invalid status value')
    if (m === 'invalid_priority') throw Errors.badRequest('invalid_priority', 'priority must be 1-5')
    throw err
  }
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const user = await resolveUser(req)
  if (!user) throw Errors.unauthorized()
  const { id: idStr } = await params
  const { id, workspaceId } = await loadAndCheck(idStr, user.id)

  const ok = await deleteIssue(workspaceId, id, user.id)
  if (!ok) throw Errors.notFound('issue')
  return NextResponse.json({ success: true })
})
