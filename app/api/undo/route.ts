import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { getTransactionLog, undoLastOperations } from '@/lib/db'
import { UNDO_MAX_COUNT } from '@/lib/limits'

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()
  const log = await getTransactionLog(50)
  return NextResponse.json(log)
})

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()
  const body = await request.json().catch(() => ({}))
  const count = Math.min(Math.max(body?.count || 1, 1), UNDO_MAX_COUNT)
  const undone = await undoLastOperations(user.id, count)
  // Action result (not a CRUD delete) — keep the descriptive shape.
  return NextResponse.json({
    success: true,
    undone_count: undone.length,
    operations: undone,
  })
})
