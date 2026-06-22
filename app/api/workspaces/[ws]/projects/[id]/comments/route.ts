import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, resolveEntityId } from '@/lib/api'
import { createComment, listComments, verifyCommentParent } from '@/lib/db/queries/comments'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'project', idStr)
  if (!(await verifyCommentParent(ctx.workspace.id, 'project', id))) {
    throw Errors.notFound('project')
  }
  const data = await listComments('project', id)
  return NextResponse.json({ data })
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'project', idStr)
  if (!(await verifyCommentParent(ctx.workspace.id, 'project', id))) {
    throw Errors.notFound('project')
  }
  const body = await req.json().catch(() => null)
  const content = typeof body?.content === 'string' ? body.content.trim() : ''
  if (!content) throw Errors.badRequest('invalid_content', 'content is required')
  const parentCommentId = typeof body?.parent_comment_id === 'number' ? body.parent_comment_id : null

  const comment = await createComment({
    workspaceId: ctx.workspace.id,
    parentType: 'project',
    parentId: id,
    userId: ctx.user.id,
    content,
    parentCommentId,
  })
  return NextResponse.json(comment, { status: 201 })
})
