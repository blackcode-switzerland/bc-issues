import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace } from '@/lib/api'
import { reorderProjects } from '@/lib/db/queries/projects'

interface Params {
  params: Promise<{ ws: string }>
}

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }

  const { ids } = body as { ids: unknown }
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'number')) {
    throw Errors.badRequest('invalid_ids', 'ids must be an array of numbers')
  }

  await reorderProjects(ctx.workspace.id, ids as number[])
  return NextResponse.json({ ok: true })
})
