import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace } from '@/lib/api'
import { deleteLabel, updateLabel } from '@/lib/db/queries/labels'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')
  const ctx = await resolveWorkspace(req, ws)
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }
  if (body.color !== undefined && (typeof body.color !== 'string' || !HEX_RE.test(body.color))) {
    throw Errors.badRequest('invalid_color', 'color must be a 7-char hex string')
  }
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
    throw Errors.badRequest('invalid_name', 'name cannot be empty')
  }
  try {
    const updated = await updateLabel(ctx.workspace.id, id, body, ctx.user.id)
    if (!updated) throw Errors.notFound('label')
    return NextResponse.json(updated)
  } catch (err) {
    if ((err as Error)?.message === 'label_exists') {
      throw Errors.conflict('label_exists', 'Another label with this name already exists')
    }
    throw err
  }
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')
  const ctx = await resolveWorkspace(req, ws)
  const ok = await deleteLabel(ctx.workspace.id, id, ctx.user.id)
  if (!ok) throw Errors.notFound('label')
  return NextResponse.json({ deleted: true })
})
