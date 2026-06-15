// Legacy /api/issues/[id]/attachments — gates via workspace membership.

import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import {
  createAttachment,
  deleteAttachment,
  getAttachment,
  getAttachments,
} from '@/lib/db/queries/attachments'
import { getIssue } from '@/lib/db/queries/issues'
import { getMembership } from '@/lib/db/queries/workspaces'

interface Params {
  params: Promise<{ id: string }>
}

async function loadIssue(issueIdStr: string, userId: number) {
  const issueId = parseInt(issueIdStr)
  if (Number.isNaN(issueId)) throw Errors.badRequest('invalid_id', 'issue id must be an integer')
  const issue = await getIssue(issueId)
  if (!issue || !issue.workspace_id) throw Errors.notFound('issue')
  const membership = await getMembership(issue.workspace_id, userId)
  if (!membership) throw Errors.notFound('issue')
  return { issueId, workspaceId: issue.workspace_id }
}

export const GET = apiHandler(async (request: NextRequest, { params }: Params) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()
  const { id } = await params
  const { issueId } = await loadIssue(id, user.id)
  const attachments = await getAttachments(issueId)
  return NextResponse.json(attachments)
})

export const POST = apiHandler(async (request: NextRequest, { params }: Params) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()
  const { id } = await params
  const { issueId } = await loadIssue(id, user.id)

  const body = await request.json()
  const { filename, file_url, file_size, mime_type } = body
  if (!filename || !file_url) {
    throw Errors.badRequest('missing_field', 'filename and file_url are required')
  }

  const attachment = await createAttachment({
    issue_id: issueId,
    filename,
    file_url,
    file_size,
    mime_type,
    uploaded_by: user.id,
  })
  return NextResponse.json(attachment, { status: 201 })
})

export const DELETE = apiHandler(async (request: NextRequest, { params }: Params) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()
  const { id } = await params
  const { issueId } = await loadIssue(id, user.id)

  const attachmentId = request.nextUrl.searchParams.get('attachmentId')
  if (!attachmentId) {
    throw Errors.badRequest('missing_attachment_id', 'Add ?attachmentId=123 to the URL')
  }
  const attachment = await getAttachment(parseInt(attachmentId))
  if (!attachment) throw Errors.notFound('attachment')
  if (attachment.issue_id !== issueId) {
    throw Errors.forbidden('Attachment does not belong to this issue')
  }
  // Anyone with workspace membership may delete attachments for now. We can
  // tighten to uploader-or-owner later if needed.
  await deleteAttachment(parseInt(attachmentId))
  return NextResponse.json({ success: true })
})
