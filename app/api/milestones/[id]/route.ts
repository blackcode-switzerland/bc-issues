// Legacy /api/milestones/[id] — looks up the milestone, verifies workspace
// membership via the milestone's workspace_id, and delegates to the new
// workspace-aware queries.

import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import {
  deleteMilestone,
  getMilestone,
  getMilestoneWithDetails,
  updateMilestone,
} from '@/lib/db/queries/milestones'
import { getIssuesByMilestone } from '@/lib/db/queries/issues'
import type { DeleteMode } from '@/lib/db/queries/deletion'
import { getMembership } from '@/lib/db/queries/workspaces'

interface Params {
  params: Promise<{ id: string }>
}

async function loadAndCheck(idStr: string, userId: number) {
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')
  const m = await getMilestone(id)
  if (!m || !m.workspace_id) throw Errors.notFound('milestone')
  const membership = await getMembership(m.workspace_id, userId)
  if (!membership) throw Errors.notFound('milestone')
  return { id, workspaceId: m.workspace_id }
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const user = await resolveUser(req)
  if (!user) throw Errors.unauthorized()
  const { id: idStr } = await params
  const { id } = await loadAndCheck(idStr, user.id)

  const includeIssues = req.nextUrl.searchParams.get('includeIssues') === 'true'
  const details = await getMilestoneWithDetails(id)
  if (!details) throw Errors.notFound('milestone')
  if (includeIssues) {
    const issues = await getIssuesByMilestone(id)
    return NextResponse.json({ ...details, issues })
  }
  return NextResponse.json(details)
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const user = await resolveUser(req)
  if (!user) throw Errors.unauthorized()
  const { id: idStr } = await params
  const { id, workspaceId } = await loadAndCheck(idStr, user.id)

  const body = await req.json()
  const updated = await updateMilestone(workspaceId, id, body, user.id)
  if (!updated) throw Errors.notFound('milestone')
  return NextResponse.json(updated)
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const user = await resolveUser(req)
  if (!user) throw Errors.unauthorized()
  const { id: idStr } = await params
  const { id, workspaceId } = await loadAndCheck(idStr, user.id)

  const mode: DeleteMode = req.nextUrl.searchParams.get('mode') === 'cascade' ? 'cascade' : 'detach'
  await deleteMilestone(workspaceId, id, user.id, mode)
  return NextResponse.json({ success: true })
})
