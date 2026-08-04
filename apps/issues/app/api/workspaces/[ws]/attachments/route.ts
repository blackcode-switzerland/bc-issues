// Workspace-wide attachments view (owner-only): every attachment row in the
// workspace, joined to its issue (#number + title) and uploader. This surfaces
// the otherwise headless `attachments` table — populated via the API/CLI
// (`bk issue attach`) — so an owner can review it. Per-issue attachments remain
// at /api/workspaces/{ws}/issues/{id}/attachments.

import { NextRequest } from 'next/server'
import { apiHandler, resolveWorkspace, requireOwner, jsonList, publicAttachment } from '@/lib/api'
import { getWorkspaceAttachments } from '@/lib/db/queries/attachments'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)
  const rows = await getWorkspaceAttachments(ctx.workspace.id)
  // issue_id is mapped to the issue #number (same as issue_seq) — the internal
  // id is never exposed, even in the owner view.
  const data = rows.map((r) => publicAttachment(r, (r as { issue_seq: number | null }).issue_seq))
  return jsonList(data, null, { total: data.length })
})
