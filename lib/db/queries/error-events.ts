// error_events queries. The public listing redacts sensitive columns; only the
// owner detail view (gated at the route layer) gets the full row.

import { and, count, desc, eq, gte, lt, lte, sql } from 'drizzle-orm'
import { db } from '../client'
import { errorEvents, type ErrorEvent, type NewErrorEvent } from '../schema'

export interface PublicErrorRow {
  id: number
  level: string
  code: string | null
  route: string | null
  method: string | null
  status_code: number | null
  occurred_at: Date
}

export interface ErrorEventsPage<T> {
  data: T[]
  next_cursor: number | null
}

export interface ListErrorEventsFilter {
  level?: string
  code?: string
  fromOccurredAt?: Date
  cursor?: number | null
  limit?: number
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function listPublicErrorEvents(
  filter: ListErrorEventsFilter = {}
): Promise<ErrorEventsPage<PublicErrorRow>> {
  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const wheres = []
  if (filter.level) wheres.push(eq(errorEvents.level, filter.level))
  if (filter.code) wheres.push(eq(errorEvents.code, filter.code))
  if (filter.fromOccurredAt) wheres.push(gte(errorEvents.occurred_at, filter.fromOccurredAt))
  if (filter.cursor) wheres.push(lt(errorEvents.id, filter.cursor))

  const rows = await db
    .select({
      id: errorEvents.id,
      level: errorEvents.level,
      code: errorEvents.code,
      route: errorEvents.route,
      method: errorEvents.method,
      status_code: errorEvents.status_code,
      occurred_at: errorEvents.occurred_at,
    })
    .from(errorEvents)
    .where(wheres.length > 0 ? and(...wheres) : undefined)
    .orderBy(desc(errorEvents.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const next_cursor = hasMore ? data[data.length - 1].id : null
  return { data, next_cursor }
}

export async function getErrorEvent(id: number): Promise<ErrorEvent | null> {
  const rows = await db.select().from(errorEvents).where(eq(errorEvents.id, id)).limit(1)
  return rows[0] ?? null
}

export async function insertErrorEvent(row: Omit<NewErrorEvent, 'id' | 'occurred_at'>) {
  await db.insert(errorEvents).values(row)
}

// ---------------------------------------------------------------------------
// Super-admin Errors tab.
//
// Unlike the public `/status` listing above, the admin view is gated behind a
// super-admin guard at the route layer and so exposes the full message plus
// triage state (resolved/unresolved). Stack traces and context remain on the
// detail endpoint (`getErrorEvent`) only.
// ---------------------------------------------------------------------------

export interface AdminErrorRow {
  id: number
  level: string
  code: string | null
  message: string
  route: string | null
  method: string | null
  status_code: number | null
  user_id: number | null
  resolved: boolean
  resolved_at: Date | null
  occurred_at: Date
}

export interface ListAdminErrorEventsFilter {
  level?: string
  /** undefined = both, true = resolved only, false = unresolved only */
  resolved?: boolean
  fromOccurredAt?: Date
  toOccurredAt?: Date
  cursor?: number | null
  limit?: number
}

export async function listAdminErrorEvents(
  filter: ListAdminErrorEventsFilter = {}
): Promise<ErrorEventsPage<AdminErrorRow>> {
  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const wheres = []
  if (filter.level) wheres.push(eq(errorEvents.level, filter.level))
  if (filter.resolved !== undefined) wheres.push(eq(errorEvents.resolved, filter.resolved))
  if (filter.fromOccurredAt) wheres.push(gte(errorEvents.occurred_at, filter.fromOccurredAt))
  if (filter.toOccurredAt) wheres.push(lte(errorEvents.occurred_at, filter.toOccurredAt))
  if (filter.cursor) wheres.push(lt(errorEvents.id, filter.cursor))

  const rows = await db
    .select({
      id: errorEvents.id,
      level: errorEvents.level,
      code: errorEvents.code,
      message: errorEvents.message,
      route: errorEvents.route,
      method: errorEvents.method,
      status_code: errorEvents.status_code,
      user_id: errorEvents.user_id,
      resolved: errorEvents.resolved,
      resolved_at: errorEvents.resolved_at,
      occurred_at: errorEvents.occurred_at,
    })
    .from(errorEvents)
    .where(wheres.length > 0 ? and(...wheres) : undefined)
    .orderBy(desc(errorEvents.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const next_cursor = hasMore ? data[data.length - 1].id : null
  return { data, next_cursor }
}

export interface ErrorEventStats {
  total: number
  resolved: number
  unresolved: number
}

export async function getErrorEventStats(): Promise<ErrorEventStats> {
  const [row] = await db
    .select({
      total: count(),
      resolved: sql<number>`count(*) filter (where ${errorEvents.resolved})::int`,
    })
    .from(errorEvents)
  const total = Number(row?.total ?? 0)
  const resolved = Number(row?.resolved ?? 0)
  return { total, resolved, unresolved: total - resolved }
}

/** Toggle triage state. Returns the updated row, or null if the id is unknown. */
export async function setErrorEventResolved(
  id: number,
  resolved: boolean,
  resolvedBy: number | null
): Promise<ErrorEvent | null> {
  const [updated] = await db
    .update(errorEvents)
    .set({
      resolved,
      resolved_at: resolved ? new Date() : null,
      resolved_by: resolved ? resolvedBy : null,
    })
    .where(eq(errorEvents.id, id))
    .returning()
  return updated ?? null
}
