// Edit + delete a single comment by id (author-only, enforced in the query).

import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace } from '@/lib/api'
import { deleteComment, updateComment } from '@/lib/db/queries/comments'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')
  const ctx = await resolveWorkspace(req, ws)
  const body = await req.json().catch(() => null)
  const content = typeof body?.content === 'string' ? body.content.trim() : ''
  if (!content) throw Errors.badRequest('invalid_content', 'content is required')
  try {
    const updated = await updateComment(ctx.workspace.id, id, content, ctx.user.id)
    if (!updated) throw Errors.notFound('comment')
    return NextResponse.json(updated)
  } catch (err) {
    if ((err as Error)?.message === 'forbidden') {
      throw Errors.forbidden('Only the comment author can edit it')
    }
    throw err
  }
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')
  const ctx = await resolveWorkspace(req, ws)
  try {
    const ok = await deleteComment(ctx.workspace.id, id, ctx.user.id)
    if (!ok) throw Errors.notFound('comment')
    return NextResponse.json({ deleted: true })
  } catch (err) {
    if ((err as Error)?.message === 'forbidden') {
      throw Errors.forbidden('Only the comment author can delete it')
    }
    throw err
  }
})
