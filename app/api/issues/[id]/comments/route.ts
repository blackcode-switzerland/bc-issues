// Legacy /api/issues/[id]/comments — uses the polymorphic comment query layer
// under the hood with parent_type='issue'.

import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { createComment, listComments } from '@/lib/db/queries/comments'
import { getIssue } from '@/lib/db/queries/issues'
import { getMembership } from '@/lib/db/queries/workspaces'

interface Params {
  params: Promise<{ id: string }>
}

async function loadIssue(idStr: string, userId: number) {
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'issue id must be an integer')
  const issue = await getIssue(id)
  if (!issue || !issue.workspace_id) throw Errors.notFound('issue')
  const membership = await getMembership(issue.workspace_id, userId)
  if (!membership) throw Errors.notFound('issue')
  return { id, workspaceId: issue.workspace_id }
}

export const GET = apiHandler(async (request: NextRequest, { params }: Params) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()
  const { id: idStr } = await params
  const { id } = await loadIssue(idStr, user.id)
  const list = await listComments('issue', id)
  return NextResponse.json(list)
})

export const POST = apiHandler(async (request: NextRequest, { params }: Params) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()
  const { id: idStr } = await params
  const { id, workspaceId } = await loadIssue(idStr, user.id)
  const body = await request.json()
  const content = typeof body?.content === 'string' ? body.content.trim() : ''
  if (!content) throw Errors.badRequest('invalid_content', 'content is required')
  const parentCommentId = typeof body?.parent_comment_id === 'number' ? body.parent_comment_id : null

  const comment = await createComment({
    workspaceId,
    parentType: 'issue',
    parentId: id,
    userId: user.id,
    content,
    parentCommentId,
  })
  return NextResponse.json(comment, { status: 201 })
})
