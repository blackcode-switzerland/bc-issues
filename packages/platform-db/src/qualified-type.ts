// `<app>:<noun>` — the app-qualified type columns on shared tables (D-14).
//
// `platform.comments.parent_type` and `platform.deletion_batches.root_type` both
// say "what kind of thing is this row about". They live in tables every app
// writes, so an unqualified `note` or `report` from two apps would collide
// silently in a table neither of them owns. Migrations 0041 and 0042 widened the
// CHECKs to accept `<app>:<noun>`; this module is the one place that spells the
// form, so there is no second copy to drift (D-27 trap 2).
//
// ---------------------------------------------------------------------------
// WHY THERE IS A `bareType` AS WELL AS A `qualifyType`
// ---------------------------------------------------------------------------
// The storage layer is qualified. The HTTP surface is not, and should not be:
// every route that returns one of these values is already app-scoped by its
// path, so `issues:issue` on the wire adds a segment the caller could not act on
// and breaks every existing consumer of it.
//
// There is also a case where qualifying the wire would have failed silently.
// `batch_root_type` is compared in `components/trash-view.tsx` against the
// item's own bare `type` to find which row is the batch root, with `?? items[0]`
// as the fallback — so a qualified value would never match, and the UI would
// have picked an arbitrary row instead of erroring. Un-qualifying at the query
// boundary keeps that comparison honest.
//
// ---------------------------------------------------------------------------
// THE LEGACY BRANCH
// ---------------------------------------------------------------------------
// `typeMatchForms` returns the qualified value AND the bare noun, because during
// the expand window a row can carry either: 0041's backfill runs at build time and
// an in-flight write from the previous build can still land bare. It is the ONE
// thing here with an expiry — at the contract step it collapses to a single
// value and the bare branch of both CHECKs goes away. Recorded in
// docs/next-fixes.md under OPEN FOLLOW-UPS.
//
// This module names no app and knows no vocabulary: the slug and the noun are
// both arguments, which is what lets a second app use it unchanged.

/** The shape both CHECK constraints enforce. Mirrors 0041/0042 exactly. */
export const QUALIFIED_TYPE_RE = /^[a-z][a-z0-9_-]{0,39}:[a-z][a-z0-9_-]{0,39}$/

/**
 * `qualifyType('issues', 'issue')` → `'issues:issue'`. What a write stores.
 *
 * Throws on a value the database would reject anyway, so a bad slug fails at the
 * call site with the offending string in the message rather than as a constraint
 * violation three frames down.
 */
export function qualifyType(app: string, noun: string): string {
  const value = `${app}:${noun}`
  if (!QUALIFIED_TYPE_RE.test(value)) {
    throw new Error(
      `not a valid app-qualified type: ${JSON.stringify(value)} — ` +
        `expected <app>:<noun>, both [a-z][a-z0-9_-]{0,39}`
    )
  }
  return value
}

/**
 * `bareType('issues:issue')` → `'issue'`. What a response carries.
 *
 * An already-bare value passes through unchanged, so this is safe to apply to a
 * row of either vintage during the expand window. `null` in, `null` out.
 */
export function bareType(value: string | null | undefined): string | null {
  if (value == null) return null
  const colon = value.indexOf(':')
  return colon === -1 ? value : value.slice(colon + 1)
}

/**
 * Every value a READ must match for one noun: the qualified form, and the bare
 * legacy form that rows written before the backfill still carry.
 *
 * Use it for the whole expand window — a read that matches only the qualified
 * form loses in-flight rows from the previous build, and one that matches only
 * the bare form loses everything after the backfill.
 */
export function typeMatchForms(app: string, noun: string): [string, string] {
  return [qualifyType(app, noun), noun]
}
