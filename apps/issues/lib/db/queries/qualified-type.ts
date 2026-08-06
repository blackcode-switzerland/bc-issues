// This app's binding of the shared `<app>:<noun>` helpers (D-14, migrations
// 0041/0042).
//
// `@blackcode/platform-db` spells the FORM and takes the slug as an argument —
// it has no business knowing which app is calling. This module pins the slug
// once, so no call site can qualify a value with the wrong app, and so the
// contract step (drop the bare legacy branch) is a change to three lines here
// rather than a hunt through the query layer.
//
// The rule for anything touching `platform.comments.parent_type` or
// `platform.deletion_batches.root_type`:
//
//   WRITE  → ownType(noun)          stores 'issues:issue'
//   FILTER → ownTypeForms(noun)     matches 'issues:issue' AND legacy 'issue'
//   RETURN → bareType(value)        the wire and the UI keep the bare noun
//
// The third is not cosmetic. `components/trash-view.tsx` finds a batch's root by
// comparing `batch_root_type` against the item's own bare `type`, falling back
// to `items[0]` — a qualified value would never match and nothing would go red.

import { sql, type SQL } from 'drizzle-orm'
import { bareType, typeMatchForms, qualifyType } from '@blackcode/platform-db'
import { APP_SLUG } from '@/lib/app'

export { bareType }

/** The value a write stores for one of this app's nouns. */
export function ownType(noun: string): string {
  return qualifyType(APP_SLUG, noun)
}

/**
 * The values a read must match for one of this app's nouns — the qualified form
 * and the bare legacy one.
 *
 * LEGACY BRANCH, EXPIRES AT THE CONTRACT STEP: 0041/0042 backfilled every
 * existing row, but a write in flight from the previous build can still land
 * bare, so both forms stay matched for one release. See docs/next-fixes.md.
 */
export function ownTypeForms(noun: string): [string, string] {
  return typeMatchForms(APP_SLUG, noun)
}

/**
 * `ownTypeForms` as a parenthesised value list, for the reads written in raw SQL
 * rather than through drizzle's query builder:
 *
 *     WHERE c.parent_type IN ${ownTypeIn('issue')}
 *
 * Same two values, same expiry. It exists so those reads share this module
 * instead of inlining a second copy of the form — the duplicate-list bug this
 * repo keeps finding (D-27 trap 2).
 */
export function ownTypeIn(noun: string): SQL {
  return sql`(${sql.join(
    ownTypeForms(noun).map((v) => sql`${v}`),
    sql`, `
  )})`
}
