// Workspace-scoped issue activity feed.
//
// Canonical replacement for legacy /api/issues/[id]/activity. The issue is
// verified to belong to the resolved workspace before its activity is returned.

import { NextRequest } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, resolveEntityId, jsonList } from '@/lib/api'
import { getIssueInWorkspace } from '@/lib/db/queries/issues'
import { getIssueActivity } from '@/lib/db'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'issue', idStr)
  const issue = await getIssueInWorkspace(ctx.workspace.id, id)
  if (!issue) throw Errors.notFound('issue')
  const activity = await getIssueActivity(id)
  return jsonList(activity)
})
