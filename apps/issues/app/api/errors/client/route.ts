// Receive client-side error reports from the top-level Error Boundary.
// We require auth so anonymous users can't spam-fill the table. Drop oversize
// stacks and sanitize context.

import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { sanitize } from '@/lib/api/sanitize'
import { insertErrorEvent } from '@/lib/db/queries/error-events'

const MAX_STACK = 8_000
const MAX_MESSAGE = 2_000

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }
  const message = typeof body.message === 'string' ? body.message.slice(0, MAX_MESSAGE) : 'Client error'
  const code = typeof body.code === 'string' ? body.code.slice(0, 50) : 'client_error'
  const stack = typeof body.stack === 'string' ? body.stack.slice(0, MAX_STACK) : null
  const route = typeof body.route === 'string' ? body.route.slice(0, 255) : null
  const context = body.context !== undefined ? sanitize(body.context) : null

  await insertErrorEvent({
    level: 'error',
    code,
    message,
    stack,
    route,
    method: null,
    status_code: null,
    user_id: user.id,
    workspace_id: null,
    context: context as Record<string, unknown> | null,
  })

  return NextResponse.json({ logged: true })
})
