// Workspace-scoped issue attachment: delete by path param.
//
// Replaces the legacy DELETE /api/issues/[id]/attachments?attachmentId=N query
// param with a RESTful path segment.

import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace } from '@/lib/api'
import { deleteAttachment, getAttachment } from '@/lib/db/queries/attachments'
import { getIssueInWorkspace } from '@/lib/db/queries/issues'

interface Params {
  params: Promise<{ ws: string; id: string; attachmentId: string }>
}

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr, attachmentId: attStr } = await params
  const issueId = parseInt(idStr)
  if (Number.isNaN(issueId)) throw Errors.badRequest('invalid_id', 'issue id must be an integer')
  const attachmentId = parseInt(attStr)
  if (Number.isNaN(attachmentId)) throw Errors.badRequest('invalid_attachment_id', 'attachment id must be an integer')

  const ctx = await resolveWorkspace(req, ws)
  const issue = await getIssueInWorkspace(ctx.workspace.id, issueId)
  if (!issue) throw Errors.notFound('issue')

  const attachment = await getAttachment(attachmentId)
  if (!attachment || attachment.issue_id !== issueId) throw Errors.notFound('attachment')

  // Anyone with workspace membership may delete attachments for now.
  await deleteAttachment(attachmentId)
  return NextResponse.json({ deleted: true })
})
