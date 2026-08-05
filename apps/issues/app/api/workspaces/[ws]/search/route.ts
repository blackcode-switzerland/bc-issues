// Federated search across every app's entities in one workspace (Phase 6).
//
// This route reads `platform.entities` and NOTHING ELSE. That is the point, not
// an implementation detail: a future sales app's tables are unreadable to this
// app's Postgres role by design (PLATFORM-ARCHITECTURE.md §4.3), so a search that
// queried each app's own tables could not be written at all — not awkwardly,
// literally not, as a database grant. Searching the shared projection is what
// makes `bk search` one query instead of a fan-out an agent has to assemble.
//
// It is deliberately NOT a replacement for `?search=` on the issue/task/project
// listings. Those search descriptions and filter by status, assignee and label —
// this one answers "where is the thing called X, in any app".

import { NextRequest } from 'next/server'
import { apiHandler, Errors, jsonList, resolveWorkspace } from '@/lib/api'
import { db } from '@/lib/db/client'
import { searchEntities } from '@blackcode/platform-db'
import { SEARCH_QUERY_MIN, SEARCH_RESULTS_MAX } from '@/lib/limits'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const sp = req.nextUrl.searchParams

  const q = (sp.get('q') ?? '').trim()
  if (q.length < SEARCH_QUERY_MIN) {
    throw Errors.badRequest(
      'query_too_short',
      `q must be at least ${SEARCH_QUERY_MIN} character(s)`,
      'pass a longer query, e.g. `bk search auth`'
    )
  }

  const limitRaw = sp.get('limit')
  let limit: number | undefined
  if (limitRaw !== null) {
    limit = parseInt(limitRaw)
    if (Number.isNaN(limit) || limit < 1 || limit > SEARCH_RESULTS_MAX) {
      throw Errors.badRequest('invalid_limit', `limit must be 1..${SEARCH_RESULTS_MAX}`)
    }
  }

  const csv = (name: string) => {
    const raw = sp.get(name)
    if (!raw) return undefined
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
    return parts.length > 0 ? parts : undefined
  }

  const results = await searchEntities(db, {
    workspaceId: ctx.workspace.id,
    query: q,
    apps: csv('app'),
    entityTypes: csv('type'),
    includeDeleted: sp.get('include_deleted') === '1',
    limit,
  })

  return jsonList(results)
})
