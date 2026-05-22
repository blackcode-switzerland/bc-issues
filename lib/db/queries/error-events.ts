// error_events queries. The public listing redacts sensitive columns; only the
// owner detail view (gated at the route layer) gets the full row.

import { and, desc, eq, gte, lt } from 'drizzle-orm'
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
