// Public list of recent errors. Redacted: no stack, no context, no user/workspace.
// Auth: none required. Rate-limit at the proxy if abused.

import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors } from '@/lib/api'
import { listPublicErrorEvents } from '@/lib/db/queries/error-events'

export const GET = apiHandler(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams
  const cursor = sp.get('cursor') ? parseInt(sp.get('cursor')!) : null
  if (cursor !== null && Number.isNaN(cursor)) {
    throw Errors.badRequest('invalid_cursor', 'cursor must be an integer')
  }
  const limit = sp.get('limit') ? parseInt(sp.get('limit')!) : undefined
  if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
    throw Errors.badRequest('invalid_limit', 'limit must be a positive integer')
  }
  const level = sp.get('level') ?? undefined
  const code = sp.get('code') ?? undefined

  const page = await listPublicErrorEvents({ level, code, cursor, limit })
  return NextResponse.json(page, {
    headers: { 'Cache-Control': 'no-store' },
  })
})
