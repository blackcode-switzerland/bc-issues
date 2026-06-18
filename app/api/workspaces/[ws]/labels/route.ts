import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, jsonList } from '@/lib/api'
import { createLabel, listLabelsInWorkspace } from '@/lib/db/queries/labels'

interface Params {
  params: Promise<{ ws: string }>
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const data = await listLabelsInWorkspace(ctx.workspace.id)
  return jsonList(data)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) throw Errors.badRequest('invalid_name', 'name is required')
  if (name.length > 50) throw Errors.badRequest('name_too_long', 'name max 50 chars')

  let color: string | undefined
  if (body.color !== undefined) {
    if (typeof body.color !== 'string' || !HEX_RE.test(body.color)) {
      throw Errors.badRequest('invalid_color', 'color must be a 7-char hex string')
    }
    color = body.color
  }

  try {
    const label = await createLabel({
      workspaceId: ctx.workspace.id,
      name,
      color,
      description: typeof body.description === 'string' ? body.description : null,
      actorUserId: ctx.user.id,
    })
    return NextResponse.json(label, { status: 201 })
  } catch (err) {
    if ((err as Error)?.message === 'label_exists') {
      throw Errors.conflict('label_exists', 'A label with this name already exists in the workspace')
    }
    throw err
  }
})
