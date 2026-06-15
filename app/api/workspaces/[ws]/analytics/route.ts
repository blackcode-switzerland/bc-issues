import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace } from '@/lib/api'
import {
  computeAnalytics,
  type AnalyticsFilters,
  type AnalyticsInterval,
  type AnalyticsView,
} from '@/lib/db/queries/analytics'

interface Params {
  params: Promise<{ ws: string }>
}

const ALLOWED_VIEWS = new Set<AnalyticsView>(['workspace', 'project', 'milestone', 'member'])

function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? undefined : d
}

// Parse a repeatable and/or CSV query param into a deduped string list.
// Accepts both ?status=a&status=b and ?status=a,b.
function parseList(sp: URLSearchParams, key: string): string[] {
  const values = sp.getAll(key).flatMap((v) => v.split(','))
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))]
}

function parseFilters(sp: URLSearchParams): AnalyticsFilters {
  const status = parseList(sp, 'status')
  const priority = parseList(sp, 'priority')
    .map((p) => parseInt(p, 10))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5)
  const label = parseList(sp, 'label')
    .map((l) => parseInt(l, 10))
    .filter((n) => Number.isInteger(n))
  const assignee = parseList(sp, 'assignee')
    .map((a) => parseInt(a, 10))
    .filter((n) => Number.isInteger(n))
  const filters: AnalyticsFilters = {}
  if (status.length) filters.status = status
  if (priority.length) filters.priority = priority
  if (label.length) filters.label = label
  if (assignee.length) filters.assignee = assignee
  return filters
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const sp = req.nextUrl.searchParams

  const view = (sp.get('view') ?? 'workspace') as AnalyticsView
  if (!ALLOWED_VIEWS.has(view)) {
    throw Errors.badRequest(
      'invalid_view',
      `view must be one of: workspace, project, milestone, member`
    )
  }

  let id: number | null = null
  if (view !== 'workspace') {
    const raw = sp.get('id')
    if (!raw) {
      throw Errors.badRequest('missing_id', `view=${view} requires id`)
    }
    const parsed = parseInt(raw)
    if (Number.isNaN(parsed)) {
      throw Errors.badRequest('invalid_id', 'id must be an integer')
    }
    id = parsed
  }

  const from = parseDate(sp.get('from'))
  const to = parseDate(sp.get('to'))
  if (from && to && from > to) {
    throw Errors.badRequest('invalid_range', 'from must be before to')
  }

  const interval: AnalyticsInterval = sp.get('interval') === 'week' ? 'week' : 'day'

  const payload = await computeAnalytics({
    workspaceId: ctx.workspace.id,
    view,
    id,
    from: from ?? null,
    to: to ?? null,
    interval,
    filters: parseFilters(sp),
  })
  return NextResponse.json(payload)
})
