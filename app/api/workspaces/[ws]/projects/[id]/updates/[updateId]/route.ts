import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace } from '@/lib/api'
import { deleteProjectUpdate } from '@/lib/db/queries/project-updates'

interface Params {
  params: Promise<{ ws: string; id: string; updateId: string }>
}

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr, updateId: updStr } = await params
  const id = parseInt(idStr)
  const updateId = parseInt(updStr)
  if (Number.isNaN(id) || Number.isNaN(updateId)) {
    throw Errors.badRequest('invalid_id', 'id must be an integer')
  }
  const ctx = await resolveWorkspace(req, ws)
  try {
    const ok = await deleteProjectUpdate(ctx.workspace.id, id, updateId, ctx.user.id)
    if (!ok) throw Errors.notFound('project_update')
  } catch (e) {
    if (e instanceof Error && e.message === 'forbidden') {
      throw Errors.forbidden('Only the author can delete this update')
    }
    throw e
  }
  return NextResponse.json({ deleted: true })
})
