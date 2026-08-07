// GET /api/workspaces/{ws}/sales-search?q= — search INSIDE this app's records
//
// ---------------------------------------------------------------------------
// THIS IS THE OTHER HALF OF D-9, AND THE PATH SAYS SO
// ---------------------------------------------------------------------------
// `/api/workspaces/{ws}/search` is the PLATFORM route (`searchRoute` in
// @blackcode/platform-api/routes) and reads `platform.entities` — titles, every
// app, URNs out. This one reads `sales.*` full text and reaches into columns the
// projection never sees: a phrase in a call summary, a name in a meeting
// outcome, the body of a template.
//
// They are DIFFERENT PATHS on purpose. Serving both at `/search` from this host
// would make which one an agent got depend on which deployment it happened to
// be pointed at — the exact invisible ambiguity D-11 removes from the verbs.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { SEARCH_TYPES, searchSales, type SearchType } from '@/lib/db/queries/search'
import { SEARCH_QUERY_MIN } from '@/lib/limits'
import { numberOr, parseList, str } from '@/lib/http-input'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = str(req.nextUrl.searchParams.get('q'))
  if (!q || q.length < SEARCH_QUERY_MIN) {
    throw Errors.badRequest(
      'query_too_short',
      `q must be at least ${SEARCH_QUERY_MIN} characters`,
      'run `bk meta` for the current limits'
    )
  }

  const types = parseList(req.nextUrl.searchParams.get('type'))
  for (const t of types) {
    if (!(SEARCH_TYPES as readonly string[]).includes(t)) {
      throw Errors.badRequest(
        'unknown_type',
        `unknown search type ${JSON.stringify(t)}`,
        'run `bk meta` for the searchable types'
      )
    }
  }

  const hits = await searchSales({
    workspaceId: ctx.workspace.id,
    workspaceSlug: ctx.workspace.slug,
    query: q,
    types: types as SearchType[],
    limit: numberOr(req.nextUrl.searchParams.get('limit')),
  })
  return jsonList(hits, null)
})
