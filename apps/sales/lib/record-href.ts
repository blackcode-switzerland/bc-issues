// Where a record lives in this web app, given its type and its #number.
//
// ---------------------------------------------------------------------------
// ONE MAP, THREE CALLERS, AND THAT IS THE POINT
// ---------------------------------------------------------------------------
// ⌘K (`components/command-palette.tsx`), the search page and the activity feed
// all have to turn "a communication, #14" into a URL. Written three times they
// would agree until one of them didn't, and the failure is a dead link in one
// surface and a working one in another — which reads as the record being gone.
//
// ---------------------------------------------------------------------------
// WHY MOST TYPES ARE `?focus=` AND NOT A DETAIL PAGE
// ---------------------------------------------------------------------------
// Meetings, communications, products, templates and documents have no detail
// page and need none: the row IS the record (`docs/frontend.md` §7). So they
// resolve to their listing with the row highlighted and scrolled to. Only a
// prospect has a page of its own, because it has four tabs' worth of children.
//
// **This used to be a SECOND map, and it disagreed with the first.**
// `lib/dashboard-paths.ts`'s `entityPath` answers a related question — where does
// `platform.entities.url` point, for a link arriving from another deployment —
// and it pointed the five `?focus=` types at detail pages that were never built.
// A D-18 link from issues into a sales meeting 404'd. Fixed 2026-08-07 by
// deleting the copy: the segments now come from `LISTING_SEGMENT`, so the two
// functions cannot disagree about where a record is, only about how a reader
// arrived at it. See that map's header for what the type system now catches.
//
// ---------------------------------------------------------------------------
// THE FOUR TYPES WITH NO #NUMBER
// ---------------------------------------------------------------------------
// `contact`, `objection`, `match` and `stage_entry` have no page and no URN —
// `lib/entity-address.ts` explains why projecting one would be worse than not
// being findable. They open their PARENT prospect, which is where they are
// displayed. Returning null instead would mean rendering a result nobody can
// click.

import { LISTING_SEGMENT } from '@/lib/dashboard-paths'

// Widened to a string key on purpose: this function is called with whatever
// `type` a search hit or an activity row carries, including the four types that
// have no #number and anything this app gains later. `LISTING_SEGMENT` is the
// narrow, exhaustive map; the lookup below is the tolerant read of it.
const LISTING: Record<string, string | undefined> = LISTING_SEGMENT

export interface RecordRef {
  type: string
  /** The workspace #number, or null for the types that have none. */
  number: number | null
  /** The prospect this record hangs off, when it hangs off one. */
  prospect_number?: number | null
}

/** Where to send a reader who clicks this record, or null if there is nowhere. */
export function recordHref(ws: string, ref: RecordRef): string | null {
  const base = `/dashboard/${ws}`
  if (ref.type === 'prospect') {
    return ref.number != null ? `${base}/prospects/${ref.number}` : null
  }
  const listing = LISTING[ref.type]
  if (listing) {
    return ref.number != null ? `${base}/${listing}?focus=${ref.number}` : null
  }
  // contact / objection / match / stage_entry — and anything this app gains
  // later that has no page of its own.
  return ref.prospect_number != null ? `${base}/prospects/${ref.prospect_number}` : null
}
