// Workspace-scoped issue attachment: delete by path param.
//
// Replaces the legacy DELETE /api/issues/[id]/attachments?attachmentId=N query
// param with a RESTful path segment.

import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, resolveEntityId } from '@/lib/api'
import { deleteAttachment, getAttachment } from '@/lib/db/queries/attachments'

interface Params {
  params: Promise<{ ws: string; id: string; attachmentId: string }>
}

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr, attachmentId: attStr } = await params
  const attachmentId = parseInt(attStr)
  if (Number.isNaN(attachmentId)) throw Errors.badRequest('invalid_attachment_id', 'attachment id must be an integer')

  const ctx = await resolveWorkspace(req, ws)
  const issueId = await resolveEntityId(ctx.workspace.id, 'issue', idStr)

  const attachment = await getAttachment(attachmentId)
  if (!attachment || attachment.issue_id !== issueId) throw Errors.notFound('attachment')

  // Anyone with workspace membership may delete attachments for now.
  await deleteAttachment(attachmentId)
  return NextResponse.json({ deleted: true })
})
