// Workspace-scoped issue activity feed.
//
// Canonical replacement for legacy /api/issues/[id]/activity. The issue is
// verified to belong to the resolved workspace before its activity is returned.

import { NextRequest } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, jsonList } from '@/lib/api'
import { getIssueInWorkspace } from '@/lib/db/queries/issues'
import { getIssueActivity } from '@/lib/db'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'issue id must be an integer')
  const ctx = await resolveWorkspace(req, ws)
  const issue = await getIssueInWorkspace(ctx.workspace.id, id)
  if (!issue) throw Errors.notFound('issue')
  const activity = await getIssueActivity(id)
  return jsonList(activity)
})
