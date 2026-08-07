// This app's contribution to the cross-app addressing scheme: the URN for an
// entity, and (re-exported) the types and paths that go into one.
//
// Split out of lib/db/queries/entities.ts for one reason: that module imports the
// database client, which throws at import time without DATABASE_URL. These values
// are worth being able to import (and unit-test) without a database.
//
// **The address MAP itself lives in `lib/dashboard-paths.ts`, which imports
// nothing.** This module cannot hold it: `formatUrn` comes from
// `@blackcode/platform-db`, whose index re-exports `createDb`, and the map is
// also read by `lib/record-href.ts` inside three "use client" trees. Read that
// file's header before moving anything back here.

import { formatUrn, formatUrnOrNull } from '@blackcode/platform-db'
import { APP_SLUG } from '@/lib/app'
import type { SalesEntityType } from '@/lib/dashboard-paths'

export {
  ENTITY_TYPES,
  LISTING_SEGMENT,
  entityPath,
  type SalesEntityType,
} from '@/lib/dashboard-paths'

/** This app's URN for an entity, given the workspace slug and its #number. */
export function entityUrn(
  workspaceSlug: string,
  entityType: SalesEntityType,
  number: number
): string {
  return formatUrn({ app: APP_SLUG, workspaceSlug, entityType, number })
}

/**
 * `entityUrn`, but null instead of a throw.
 *
 * Every write path uses this one. See `formatUrnOrNull` in platform-db for why:
 * the projection must never be able to fail the write it is projecting.
 */
export function entityUrnOrNull(
  workspaceSlug: string,
  entityType: SalesEntityType,
  number: number
): string | null {
  return formatUrnOrNull({ app: APP_SLUG, workspaceSlug, entityType, number })
}
