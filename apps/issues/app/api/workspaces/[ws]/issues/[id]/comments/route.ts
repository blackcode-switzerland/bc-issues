import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, resolveEntityId, jsonList, publicComment } from '@/lib/api'
import { createComment, listComments, verifyCommentParent } from '@/lib/db/queries/comments'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'issue', idStr)
  if (!(await verifyCommentParent(ctx.workspace.id, 'issue', id))) {
    throw Errors.notFound('issue')
  }
  const data = await listComments('issue', id)
  return jsonList(data.map((c) => publicComment(c, Number(idStr))))
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'issue', idStr)
  if (!(await verifyCommentParent(ctx.workspace.id, 'issue', id))) {
    throw Errors.notFound('issue')
  }
  const body = await req.json().catch(() => null)
  const content = typeof body?.content === 'string' ? body.content.trim() : ''
  if (!content) throw Errors.badRequest('invalid_content', 'content is required')
  const parentCommentId = typeof body?.parent_comment_id === 'number' ? body.parent_comment_id : null

  const comment = await createComment({
    workspaceId: ctx.workspace.id,
    parentType: 'issue',
    parentId: id,
    userId: ctx.user.id,
    content,
    parentCommentId,
  })
  return NextResponse.json(publicComment(comment, Number(idStr)), { status: 201 })
})
