// GET /api/workspaces/{ws}/metrics?period=30d — how the last N days went
//
// `win_rate` is null rather than 0 when nothing closed: "we closed nothing" and
// "we lost everything" are not the same month, and a 0% meaning the first is a
// number somebody will act on.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { metrics } from '@/lib/db/queries/aggregates'
import { str } from '@/lib/http-input'

interface Params {
  params: Promise<{ ws: string }>
}

/** `30d`, `90d`, `12w`, `6m`. A shape, not an enumeration — see below. */
const PERIOD = /^(\d+)\s*(d|w|m)$/i

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)

  // Parsed by SHAPE rather than matched against a list of allowed periods.
  // §6.1 names `30d|90d`; hardcoding those two would make `--period 14d` fail
  // for no reason a caller could see, and a period is not a vocabulary — there
  // is nothing for `bk meta` to serve about it.
  const raw = str(req.nextUrl.searchParams.get('period')) ?? '30d'
  const m = PERIOD.exec(raw)
  if (!m) {
    throw Errors.badRequest(
      'invalid_period',
      `period must look like 30d, 12w or 6m — got ${JSON.stringify(raw)}`,
      'pass --period 90d'
    )
  }
  const n = Number(m[1])
  const unit = m[2]!.toLowerCase()
  const days = unit === 'd' ? n : unit === 'w' ? n * 7 : n * 30
  if (days < 1 || days > 3650) {
    throw Errors.badRequest(
      'invalid_period',
      `period must be between 1 day and 10 years, got ${JSON.stringify(raw)}`,
      'pass --period 90d'
    )
  }

  return NextResponse.json(await metrics(ctx.workspace.id, days))
})
