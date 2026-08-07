// Where this app's entities live, as pure functions.
//
// Split out of lib/db/queries/entities.ts for one reason: that module imports the
// database client, which throws at import time without DATABASE_URL. These values
// are the app's contribution to the cross-app addressing scheme — the URN entity
// types, the dashboard route for each, and the URN itself — and they are worth
// being able to import (and unit-test) without a database.

import { formatUrn, formatUrnOrNull } from '@blackcode/platform-db'
import { APP_SLUG } from '@/lib/app'

/**
 * The entity types this app projects — one per source table with a #number.
 *
 * **Contacts, stage entries, objections and matches are deliberately absent.**
 * None of them has an independent identity or a #number: a contact is always
 * reached through its prospect, a stage entry is a step in one prospect's
 * journey, and a match is a verdict about a (prospect, product) pair. Projecting
 * one would advertise an address `bk` cannot resolve, which is worse than not
 * being findable — `bk search` would return a URN that goes nowhere.
 */
export const ENTITY_TYPES = [
  'prospect',
  'meeting',
  'communication',
  'product',
  'template',
  'document',
] as const
export type SalesEntityType = (typeof ENTITY_TYPES)[number]

// The dashboard path segment for each type. One map, so a route rename is one
// edit here plus one reconciliation run, rather than a silent divergence between
// what the projection says and where the page actually is.
const PATH_SEGMENT: Record<SalesEntityType, string> = {
  prospect: 'prospects',
  meeting: 'meetings',
  communication: 'communications',
  product: 'products',
  template: 'templates',
  document: 'documents',
}

/** Where this app puts a given entity, relative to its own base_url. */
export function entityPath(
  workspaceSlug: string,
  entityType: SalesEntityType,
  number: number
): string {
  return `/dashboard/${workspaceSlug}/${PATH_SEGMENT[entityType]}/${number}`
}

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
