// apiHandler() — wraps a Next.js App Router route handler with:
//  1. canonical error response shape ({ error: { code, message, details? } })
//  2. error_events logging for 5xx and unexpected throws
//  3. a placeholder for future workspace/user context attachment
//
// Usage:
//
//   export const GET = apiHandler(async (req) => {
//     const user = await resolveUser(req)
//     if (!user) throw Errors.unauthorized()
//     ...
//     return NextResponse.json({ data })
//   })
//
// 4xx ApiErrors (unauthorized, forbidden, not_found, bad_request, conflict)
// are returned to the client but NOT logged — they are normal client errors.
// 5xx ApiErrors and any non-ApiError throwable ARE logged to error_events.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { errorEvents, type NewErrorEvent } from '@/lib/db/schema'
import { ApiError } from './errors'
import { sanitize, truncate } from './sanitize'

type RouteContext = unknown

type Handler<TCtx extends RouteContext> = (
  req: NextRequest,
  ctx: TCtx
) => Promise<NextResponse | Response> | NextResponse | Response

export function apiHandler<TCtx extends RouteContext = RouteContext>(
  handler: Handler<TCtx>
): (req: NextRequest, ctx: TCtx) => Promise<NextResponse | Response> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx)
    } catch (err) {
      return await handleError(err, req)
    }
  }
}

async function handleError(err: unknown, req: NextRequest): Promise<NextResponse> {
  if (err instanceof ApiError) {
    if (err.status >= 500) {
      await safeLog({
        level: 'error',
        code: err.code,
        message: err.message,
        stack: err.stack ?? null,
        route: routePath(req),
        method: req.method,
        status_code: err.status,
        context: err.details ? { details: sanitize(err.details) } : null,
      })
    }
    return NextResponse.json(buildResponseBody(err), { status: err.status })
  }

  const e = err as { message?: string; stack?: string; name?: string } | null | undefined
  await safeLog({
    level: 'error',
    code: 'internal_error',
    message: e?.message ?? 'Unknown error',
    stack: e?.stack ?? null,
    route: routePath(req),
    method: req.method,
    status_code: 500,
    context: { name: e?.name ?? 'Unknown' },
  })

  return NextResponse.json(
    {
      error: 'Internal server error',
      code: 'internal_error',
    },
    { status: 500 }
  )
}

// Response shape kept backward-compatible with the existing CLI APIError:
//   { error: string, code?: string, suggestion?: string, details?: unknown }
//
// `error` is the human-readable message (what the CLI surfaces). `code` is the
// machine-readable identifier the web client branches on. `suggestion` is the
// optional "what to do about it" hint, used by the CLI today. `details` is
// structured context for the web client; the CLI ignores it.
function buildResponseBody(err: ApiError): Record<string, unknown> {
  const body: Record<string, unknown> = {
    error: err.message,
    code: err.code,
  }
  if (typeof err.details === 'string') {
    body.suggestion = err.details
  } else if (err.details !== undefined) {
    body.details = err.details
  }
  return body
}

async function safeLog(row: Omit<NewErrorEvent, 'id' | 'occurred_at'> & { stack?: string | null }): Promise<void> {
  try {
    await db.insert(errorEvents).values({
      level: row.level,
      code: truncate(row.code ?? null, 50),
      message: truncate(row.message, 8_000) ?? 'Unknown',
      stack: truncate(row.stack ?? null, 8_000),
      route: truncate(row.route ?? null, 255),
      method: truncate(row.method ?? null, 10),
      status_code: row.status_code ?? null,
      user_id: row.user_id ?? null,
      workspace_id: row.workspace_id ?? null,
      context: row.context ?? null,
    })
  } catch (logErr) {
    // Never let logging block the response. Surface to stderr so it's visible
    // in dev / vercel logs, but don't propagate.
    console.error('[apiHandler] failed to write error_events:', logErr)
  }
}

function routePath(req: NextRequest): string {
  try {
    return new URL(req.url).pathname
  } catch {
    return ''
  }
}
