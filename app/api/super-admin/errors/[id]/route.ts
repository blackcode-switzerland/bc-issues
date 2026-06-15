import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors } from '@/lib/api'
import { requireSuperAdminUser } from '@/lib/api/super-admin-guard'
import { getErrorEvent, setErrorEventResolved } from '@/lib/db/queries/error-events'

interface Params {
  params: Promise<{ id: string }>
}

// GET /api/super-admin/errors/[id] — full detail incl. stack + context.
export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  await requireSuperAdminUser(req)
  const id = parseId((await params).id)
  const event = await getErrorEvent(id)
  if (!event) throw Errors.notFound('Error event not found')
  return NextResponse.json({ data: event })
})

// PATCH /api/super-admin/errors/[id] — toggle triage state. Body: { resolved: boolean }
export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSuperAdminUser(req)
  const id = parseId((await params).id)

  const body = await req.json().catch(() => null)
  if (!body || typeof body.resolved !== 'boolean') {
    throw Errors.badRequest('invalid_body', 'resolved (boolean) is required')
  }

  const updated = await setErrorEventResolved(id, body.resolved, user.id)
  if (!updated) throw Errors.notFound('Error event not found')
  return NextResponse.json({ data: updated })
})

function parseId(raw: string): number {
  const id = parseInt(raw, 10)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be a number')
  return id
}
