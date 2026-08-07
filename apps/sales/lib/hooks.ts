'use client'

// The query hooks every page reads through.
//
// ── THE WIRE TYPES ARE IMPORTED, NOT RETYPED ────────────────────────────────
// `import type` from the query layer and from `lib/views.ts`. The imports are
// erased at compile time, so no server module — and no drizzle client — reaches
// the browser bundle; what survives is that a change to `TodayResult` becomes a
// type error in the page that reads it, in the same `npm run typecheck`.
//
// Hand-writing a second copy of these interfaces here is the obvious
// alternative and it is the wrong one: two shapes that must agree, kept in
// agreement by nobody, is the drift `lib/views.ts` exists to prevent on the wire
// and the same argument applies one layer up.
//
// ── EVERY KEY CARRIES THE WORKSPACE ─────────────────────────────────────────
// `['today', ws]`, never `['today']`. This app shows one workspace and the
// picker is a branch almost nobody sees (D-3), which is exactly why a cache key
// that ignored the workspace would be wrong in a way nobody would reproduce.

import { useQuery } from '@tanstack/react-query'
import type { PipelineResult, TodayResult } from '@/lib/db/queries/aggregates'
import type { PublicProspect } from '@/lib/views'
import { apiGet, query, wsPath, type ListPage } from '@/lib/client'

/** What is owed today, and who we are meeting today. */
export function useToday(ws: string) {
  return useQuery({
    queryKey: ['today', ws],
    queryFn: () => apiGet<TodayResult>(wsPath(ws, '/today')),
  })
}

/** Where the money is, by stage. */
export function usePipeline(ws: string) {
  return useQuery({
    queryKey: ['pipeline', ws],
    queryFn: () => apiGet<PipelineResult>(wsPath(ws, '/pipeline')),
  })
}

/** A meeting, in the shape `publicMeeting` serves. */
export interface Meeting {
  number: number
  prospect_number: number
  prospect_name: string
  starts_at: string
  duration_min: number | null
  type: string
  status: string
  title: string
  attendees: string[]
  agenda: string | null
  outcome: string | null
  urn: string | null
  created_at: string
  deleted_at: string | null
}

/**
 * The next meetings across every prospect — Today's own block (§8.2), not
 * something buried in one deal's card.
 *
 * ── THE SORT IS DONE HERE, AND THAT IS NOT LAZINESS ────────────────────────
 * `GET …/meetings` orders `starts_at DESC` deliberately: the ledger's reader
 * asks "what is next / what just happened", and both live at that end of a list
 * that is mostly past. But DESC + a small `limit` returns the FURTHEST-out
 * meetings, not the nearest — `limit=5` on an upcoming filter would show next
 * quarter and hide tomorrow.
 *
 * So this asks for a page big enough to hold every upcoming meeting a real
 * workspace has and sorts ascending here. `has_more` is returned rather than
 * swallowed: a workspace that genuinely has more upcoming meetings than one page
 * would silently lose the nearest ones, and a block that is quietly wrong is
 * worse than one that says so. If that ever fires, the fix is an `order` or
 * `soonest` parameter on the route, which is agent5's surface and not something
 * to paper over from here.
 */
export function useUpcomingMeetings(ws: string, take = 5) {
  return useQuery({
    queryKey: ['meetings', ws, 'upcoming', take],
    queryFn: async () => {
      const page = await apiGet<ListPage<Meeting>>(
        wsPath(ws, '/meetings') + query({ status: 'upcoming', limit: 100 })
      )
      const sorted = [...page.data].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      return {
        meetings: sorted.slice(0, take),
        total: sorted.length,
        has_more: page.next_cursor != null,
      }
    },
  })
}

/**
 * Every prospect, indexed by #number.
 *
 * Today's queue needs a deal value beside each name and `today.due_actions` does
 * not carry one — it answers "what is owed", and a value is not part of that
 * answer. Rather than ask agent5 to widen the aggregate's shape, the page joins
 * against the list route it would have to load for the Prospects page anyway,
 * and TanStack shares the cache entry between the two.
 */
export function useProspectsByNumber(ws: string) {
  return useQuery({
    queryKey: ['prospects', ws, 'all'],
    queryFn: async () => {
      const page = await apiGet<ListPage<PublicProspect>>(
        wsPath(ws, '/prospects') + query({ limit: 100 })
      )
      return new Map(page.data.map((p) => [p.number, p]))
    },
  })
}
