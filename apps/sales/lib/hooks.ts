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
import type { MetricsResult, PipelineResult, TodayResult } from '@/lib/db/queries/aggregates'
import type { PublicLink, PublicProspect } from '@/lib/views'
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

/** The filters every list page shares. Absent/empty means "no filter". */
export interface ProspectFilters {
  stage?: string
  label?: string
  q?: string
}

/** The prospects list, filtered. */
export function useProspects(ws: string, filters: ProspectFilters = {}) {
  return useQuery({
    queryKey: ['prospects', ws, filters],
    queryFn: async () => {
      const page = await apiGet<ListPage<PublicProspect>>(
        wsPath(ws, '/prospects') + query({ ...filters, limit: 100 })
      )
      return page
    },
  })
}

/** A prospect's journey step, as the detail route serves it. */
export interface JourneyStep {
  stage: string
  status: string
  occurred_at: string | null
  actor: string | null
  note: string | null
}

/** One prospect, plus its journey and its cross-app links (D-18). */
export type ProspectDetail = PublicProspect & {
  journey: JourneyStep[]
  links: PublicLink[]
}

export function useProspect(ws: string, n: number) {
  return useQuery({
    queryKey: ['prospect', ws, n],
    queryFn: () => apiGet<ProspectDetail>(wsPath(ws, `/prospects/${n}`)),
  })
}

export interface Contact {
  id: number
  name: string
  role: string | null
  email: string | null
  phone: string | null
  is_primary: boolean
  notes: string | null
}

export interface Objection {
  id: number
  type: string
  raised_by: string | null
  raised_at: string | null
  status: string
  spoken: string | null
  real_fear: string | null
  counter: string | null
}

export interface Match {
  product_number: number
  product_name: string
  template_number: number | null
  template_name: string | null
  fit: number | null
  why: string | null
  computed_at: string | null
  computed_by: string | null
}

export function useContacts(ws: string, n: number) {
  return useQuery({
    queryKey: ['contacts', ws, n],
    queryFn: async () =>
      (await apiGet<ListPage<Contact>>(wsPath(ws, `/prospects/${n}/contacts`))).data,
  })
}

export function useObjections(ws: string, n: number) {
  return useQuery({
    queryKey: ['objections', ws, n],
    queryFn: async () =>
      (await apiGet<ListPage<Objection>>(wsPath(ws, `/prospects/${n}/objections`))).data,
  })
}

/**
 * Triangulation — the stored result of client × product × message (D-9 / §1.2
 * rule 2).
 *
 * **The matching is not done here and must never be.** These rows were written
 * by the agent through `bk sales match set`; this hook reads them. A component
 * that started ranking products by "fit" in the browser would be the one thing
 * the doctrine forbids.
 */
export function useMatches(ws: string, n: number) {
  return useQuery({
    queryKey: ['matches', ws, n],
    queryFn: async () =>
      (await apiGet<ListPage<Match>>(wsPath(ws, `/prospects/${n}/matches`))).data,
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

// ---------------------------------------------------------------------------
// The ledgers and the catalog
// ---------------------------------------------------------------------------

/** A communication, in the shape `publicComm` serves. */
export interface Communication {
  number: number
  prospect_number: number
  prospect_name: string
  channel: string
  direction: string
  occurred_at: string
  subject: string | null
  body: string | null
  contact: string | null
  logged_by: string | null
  urn: string | null
  created_at: string
  deleted_at: string | null
}

export interface Product {
  number: number
  category: string
  name: string
  price_label: string | null
  price_from: string | null
  price_to: string | null
  currency: string
  description: string | null
  fit: string[]
  pitch: string | null
  status_label: string | null
  refs: string[]
  urn: string | null
  deleted_at: string | null
}

export interface Template {
  number: number
  channel: string
  category: string
  stage: string | null
  name: string
  subject: string | null
  body: string | null
  variables: string[]
  urn: string | null
  deleted_at: string | null
}

export interface SalesDocument {
  number: number
  title: string
  kind: string
  upload_url: string | null
  external_url: string | null
  size_bytes: number | null
  mime_type: string | null
  description: string | null
  tags: string[]
  added_by: string | null
  prospects: number[]
  products: number[]
  urn: string | null
  deleted_at: string | null
}

/**
 * The meetings ledger. `prospect` filters it to one deal, which is what the
 * prospect detail page's Meetings tab passes — the same route, not a second one,
 * so the tab cannot drift from the cross-prospect view.
 */
export function useMeetings(ws: string, opts: { prospect?: number; status?: string } = {}) {
  return useQuery({
    queryKey: ['meetings', ws, opts],
    queryFn: async () =>
      (
        await apiGet<ListPage<Meeting>>(
          wsPath(ws, '/meetings') + query({ ...opts, limit: 100 })
        )
      ).data,
  })
}

export function useCommunications(
  ws: string,
  opts: { prospect?: number; channel?: string } = {}
) {
  return useQuery({
    queryKey: ['communications', ws, opts],
    queryFn: async () =>
      (
        await apiGet<ListPage<Communication>>(
          wsPath(ws, '/communications') + query({ ...opts, limit: 100 })
        )
      ).data,
  })
}

export function useProducts(ws: string) {
  return useQuery({
    queryKey: ['products', ws],
    queryFn: async () =>
      (await apiGet<ListPage<Product>>(wsPath(ws, '/products') + query({ limit: 100 }))).data,
  })
}

export function useTemplates(ws: string) {
  return useQuery({
    queryKey: ['templates', ws],
    queryFn: async () =>
      (await apiGet<ListPage<Template>>(wsPath(ws, '/templates') + query({ limit: 100 }))).data,
  })
}

/**
 * The document library. `prospect` filters it — and that filter is what makes
 * the prospect detail page's Documents tab **a view into the one library rather
 * than a parallel store** (D-8, the fix UPDATE-6 was written to make). Same
 * route, same rows, one `where`.
 */
export function useDocuments(ws: string, opts: { prospect?: number; kind?: string; q?: string } = {}) {
  return useQuery({
    queryKey: ['documents', ws, opts],
    queryFn: async () =>
      (
        await apiGet<ListPage<SalesDocument>>(
          wsPath(ws, '/documents') + query({ ...opts, limit: 100 })
        )
      ).data,
  })
}

/**
 * How the last N days went. Computed in SQL, never stored (D-33).
 *
 * `period` is a SHAPE (`30d`, `12w`, `6m`), not a vocabulary — the route parses
 * it rather than matching a list, so the page is free to offer whichever spans
 * are useful without a server change.
 */
export function useMetrics(ws: string, period: string) {
  return useQuery({
    queryKey: ['metrics', ws, period],
    queryFn: () => apiGet<MetricsResult>(wsPath(ws, '/metrics') + query({ period })),
  })
}

/** A binned record, in the shape `bk sales trash list` parses. */
export interface TrashItem {
  type: string
  number: number | null
  title: string
  deleted_at: string | null
  deleted_by: string | null
}

export function useTrash(ws: string) {
  return useQuery({
    queryKey: ['trash', ws],
    queryFn: async () => (await apiGet<ListPage<TrashItem>>(wsPath(ws, '/trash'))).data,
  })
}
