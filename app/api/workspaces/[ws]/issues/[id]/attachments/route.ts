// Workspace-scoped issue attachments: list + create.
//
// Canonical replacement for the legacy /api/issues/[id]/attachments route.
// The workspace is explicit in the path and the issue is verified to belong to
// it via getIssueInWorkspace (no implicit active-workspace resolution).

import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, resolveEntityId, jsonList, publicAttachment } from '@/lib/api'
import { createAttachment, getAttachments } from '@/lib/db/queries/attachments'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

async function resolveIssue(ws: string, idStr: string, req: NextRequest) {
  const ctx = await resolveWorkspace(req, ws)
  // idStr is the workspace #number (seq); resolve to the internal issue id.
  const issueId = await resolveEntityId(ctx.workspace.id, 'issue', idStr)
  return { ctx, issueId }
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id } = await params
  const { issueId } = await resolveIssue(ws, id, req)
  const attachments = await getAttachments(issueId)
  return jsonList(attachments.map((a) => publicAttachment(a, Number(id))))
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id } = await params
  const { ctx, issueId } = await resolveIssue(ws, id, req)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }
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
    uploaded_by: ctx.user.id,
  })
  return NextResponse.json(attachment ? publicAttachment(attachment, Number(id)) : attachment, {
    status: 201,
  })
})
