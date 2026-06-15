import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors } from '@/lib/api'
import { requireSuperAdminUser } from '@/lib/api/super-admin-guard'
import {
  listAdminErrorEvents,
  getErrorEventStats,
  deleteErrorEvents,
  type ListAdminErrorEventsFilter,
} from '@/lib/db/queries/error-events'

const MAX_BULK_DELETE = 500

// GET /api/super-admin/errors
//   ?level=error            filter by severity level
//   ?status=resolved|open   filter by triage state (omitted = all)
//   ?from=<ISO>&to=<ISO>    occurred_at date range
//   ?cursor=<id>&limit=<n>  cursor pagination
//   ?stats=1                also return aggregate counts
export const GET = apiHandler(async (req: NextRequest) => {
  await requireSuperAdminUser(req)
  const sp = new URL(req.url).searchParams

  const filter: ListAdminErrorEventsFilter = {}

  const level = sp.get('level')
  if (level) filter.level = level

  const status = sp.get('status')
  if (status === 'resolved') filter.resolved = true
  else if (status === 'open' || status === 'unresolved') filter.resolved = false

  const from = parseDate(sp.get('from'))
  if (from) filter.fromOccurredAt = from
  const to = parseDate(sp.get('to'))
  if (to) filter.toOccurredAt = to

  const cursor = sp.get('cursor')
  if (cursor) filter.cursor = Number(cursor) || null
  const limit = sp.get('limit')
  if (limit) filter.limit = Number(limit) || undefined

  const page = await listAdminErrorEvents(filter)

  if (sp.get('stats') === '1') {
    const stats = await getErrorEventStats()
    return NextResponse.json({ ...page, stats })
  }
  return NextResponse.json(page)
})

// DELETE /api/super-admin/errors — bulk delete. Body: { ids: number[] }
export const DELETE = apiHandler(async (req: NextRequest) => {
  await requireSuperAdminUser(req)
  const body = await req.json().catch(() => null)
  if (!Array.isArray(body?.ids)) {
    throw Errors.badRequest('invalid_ids', 'ids (number[]) is required')
  }

  const ids = [
    ...new Set((body.ids as unknown[]).filter((n): n is number => Number.isInteger(n))),
  ]
  if (ids.length === 0) throw Errors.badRequest('invalid_ids', 'no valid ids provided')
  if (ids.length > MAX_BULK_DELETE) {
    throw Errors.badRequest('too_many', `cannot delete more than ${MAX_BULK_DELETE} at once`)
  }

  const deleted = await deleteErrorEvents(ids)
  return NextResponse.json({ deleted })
})

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d
}
