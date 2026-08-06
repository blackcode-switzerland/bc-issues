// Reading `platform.events` — the activity feed.
//
// The events TABLE is platform (Phase 6 gave it `app` and `subject_urn`), and so
// is this query: events + the actor's name/email, nothing else. It moved from
// `apps/issues/lib/db/queries/events.ts` on 2026-08-06 with
// GET /api/workspaces/{ws}/activity (docs/sales-app-plan.md Phase 1b).
//
// WRITING an event did NOT move. `recordEvent` resolves a cross-app subject URN
// from the app's own tables and fans out through rules written in terms of one
// app's nouns; splitting that is its own piece of work with its own owner.
//
// `entityTypes` and `actions` are `string[]` here, not the app's unions. This
// package cannot know an app's vocabulary, and the ROUTE is where an unknown
// value has to be rejected — a filter that silently matches nothing is worse
// than a 400, because it returns a plausible empty page.

import { and, desc, eq, gte, inArray, lt, lte } from 'drizzle-orm'
import type { PlatformDb } from './client'
import { events, users, type Event } from './schema'

export interface ListEventsFilter {
  workspaceId: number
  actorUserIds?: number[]
  entityTypes?: string[]
  actions?: string[]
  /** Restrict to events produced by these apps. */
  apps?: string[]
  /** Restrict to events about one cross-app subject. */
  subjectUrn?: string
  fromOccurredAt?: Date
  toOccurredAt?: Date
  /** Keyset cursor: an event id. */
  cursor?: number | null
  limit?: number
}

export interface EventListItem extends Event {
  actor_name: string | null
  actor_email: string | null
}

export interface EventsPage {
  data: EventListItem[]
  next_cursor: number | null
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function listEvents(db: PlatformDb, filter: ListEventsFilter): Promise<EventsPage> {
  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

  const wheres = [eq(events.workspace_id, filter.workspaceId)]
  if (filter.actorUserIds && filter.actorUserIds.length > 0) {
    wheres.push(inArray(events.actor_user_id, filter.actorUserIds))
  }
  if (filter.entityTypes && filter.entityTypes.length > 0) {
    wheres.push(inArray(events.entity_type, filter.entityTypes))
  }
  if (filter.actions && filter.actions.length > 0) {
    wheres.push(inArray(events.action, filter.actions))
  }
  if (filter.apps && filter.apps.length > 0) {
    wheres.push(inArray(events.app, filter.apps))
  }
  if (filter.subjectUrn) {
    wheres.push(eq(events.subject_urn, filter.subjectUrn))
  }
  if (filter.fromOccurredAt) {
    wheres.push(gte(events.occurred_at, filter.fromOccurredAt))
  }
  if (filter.toOccurredAt) {
    wheres.push(lte(events.occurred_at, filter.toOccurredAt))
  }
  if (filter.cursor) {
    wheres.push(lt(events.id, filter.cursor))
  }

  const rows = await db
    .select({
      e: events,
      actor_name: users.name,
      actor_email: users.email,
    })
    .from(events)
    .leftJoin(users, eq(users.id, events.actor_user_id))
    .where(and(...wheres))
    .orderBy(desc(events.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const data = rows.slice(0, limit).map((r) => ({
    ...r.e,
    actor_name: r.actor_name,
    actor_email: r.actor_email,
  }))
  const next_cursor = hasMore ? data[data.length - 1].id : null
  return { data, next_cursor }
}
