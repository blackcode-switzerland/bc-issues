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
// **This is deliberately NOT `lib/entity-address.ts`'s `entityPath`.** That one
// answers a different question — where does `platform.entities.path` point, for
// a link arriving from another deployment — and it is a server-side value stored
// at write time. They currently disagree for the five `?focus=` types; that is
// recorded for agent8 (Phase 10 owns cross-app link resolution) rather than
// changed here, because changing it rewrites stored rows.
//
// ---------------------------------------------------------------------------
// THE FOUR TYPES WITH NO #NUMBER
// ---------------------------------------------------------------------------
// `contact`, `objection`, `match` and `stage_entry` have no page and no URN —
// `lib/entity-address.ts` explains why projecting one would be worse than not
// being findable. They open their PARENT prospect, which is where they are
// displayed. Returning null instead would mean rendering a result nobody can
// click.

/** The listing each numbered type is shown in. */
const LISTING: Record<string, string> = {
  meeting: 'meetings',
  communication: 'communications',
  product: 'products',
  template: 'templates',
  document: 'documents',
}

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
