// events queries — the spine of activity, inbox, analytics.
//
// recordEvent MUST be called inside the transaction that produces the
// mutation. The application layer is the only place where events are
// invented; the database does not have triggers (deliberate — see §1.4).
//
// The transaction handle is typed as `Tx` (a subset of the Drizzle interface).
// Both `db` and `tx` satisfy it.

import { and, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm'
import { db } from '../client'
import { events, users, issues, tasks, projects, type Event, type NewEvent } from '../schema'
import { fanOutEvent } from './fanout'

export type EntityType =
  | 'workspace'
  | 'workspace_member'
  | 'invitation'
  | 'project'
  | 'task'
  | 'issue'
  | 'comment'
  | 'attachment'
  | 'label'

export type EventAction =
  // workspace
  | 'created'
  | 'updated'
  | 'deleted'
  | 'ownership_transferred'
  // members
  | 'member_added'
  | 'member_removed'
  | 'member_left'
  // invitations
  | 'invitation_created'
  | 'invitation_revoked'
  | 'invitation_accepted'
  | 'invitation_declined'
  // issues / domain (used in later phases)
  | 'commented'
  | 'assigned'
  | 'unassigned'
  | 'status_changed'
  | 'priority_changed'
  | 'task_changed'
  | 'project_changed'
  | 'labeled'
  | 'unlabeled'
  | 'attached'
  | 'unattached'
  | 'mentioned'
  | 'due_date_changed'
  // recycle bin
  | 'restored'
  | 'purged'

export interface RecordEventInput {
  workspaceId: number
  actorUserId?: number | null
  actorTokenId?: number | null
  entityType: EntityType
  entityId: number
  action: EventAction
  diff?: { before?: unknown; after?: unknown } | null
  meta?: Record<string, unknown> | null
  idempotencyKey?: string | null
  occurredAt?: Date
}

type Tx = Pick<typeof db, 'insert' | 'select' | 'update' | 'delete' | 'execute'>

export async function recordEvent(tx: Tx, input: RecordEventInput): Promise<Event> {
  const values: NewEvent = {
    workspace_id: input.workspaceId,
    actor_user_id: input.actorUserId ?? null,
    actor_token_id: input.actorTokenId ?? null,
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action,
    diff: input.diff ?? null,
    meta: input.meta ?? null,
    idempotency_key: input.idempotencyKey ?? null,
    occurred_at: input.occurredAt ?? new Date(),
  }
  const [row] = await tx.insert(events).values(values).returning()
  if (!row) throw new Error('event insert returned nothing')
  await fanOutEvent(tx, row)
  return row
}

// ---------- listing / activity feed ----------

export interface ListEventsFilter {
  workspaceId: number
  actorUserIds?: number[]
  entityTypes?: EntityType[]
  actions?: EventAction[]
  fromOccurredAt?: Date
  toOccurredAt?: Date
  cursor?: number | null // event id
  limit?: number // default 50, max 200
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

export async function listEvents(filter: ListEventsFilter): Promise<EventsPage> {
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

// Resolve the workspace #number (seq) for the issue/task/project entities a page
// of events points at, so the API can expose `entity_id` as the #number instead
// of the internal serial. Other entity types (comment/label/attachment/workspace/
// member/invitation) keep their own-domain id, so they're skipped here.
// Trashed rows are included (events for binned items still resolve); purged rows
// are simply absent from the map (caller falls back to meta.seq or null).
export async function resolveEventEntitySeqs(
  rows: Array<{ entity_type: string; entity_id: number }>
): Promise<Map<string, number>> {
  const ids: Record<'issue' | 'task' | 'project', Set<number>> = {
    issue: new Set(),
    task: new Set(),
    project: new Set(),
  }
  for (const r of rows) {
    if (r.entity_type === 'issue' || r.entity_type === 'task' || r.entity_type === 'project') {
      ids[r.entity_type].add(r.entity_id)
    }
  }
  const tables = { issue: issues, task: tasks, project: projects } as const
  const map = new Map<string, number>()
  for (const type of ['issue', 'task', 'project'] as const) {
    const list = [...ids[type]]
    if (list.length === 0) continue
    const found = await db
      .select({ id: tables[type].id, seq: tables[type].seq })
      .from(tables[type])
      .where(inArray(tables[type].id, list))
    for (const f of found) {
      if (f.seq != null) map.set(`${type}:${f.id}`, f.seq)
    }
  }
  return map
}

// Entity-scoped history (used by issue detail page, member achievements, etc.)
export async function listEntityHistory(
  workspaceId: number,
  entityType: EntityType,
  entityId: number,
  limit = 100
): Promise<EventListItem[]> {
  const rows = await db
    .select({
      e: events,
      actor_name: users.name,
      actor_email: users.email,
    })
    .from(events)
    .leftJoin(users, eq(users.id, events.actor_user_id))
    .where(
      and(
        eq(events.workspace_id, workspaceId),
        eq(events.entity_type, entityType),
        eq(events.entity_id, entityId)
      )
    )
    .orderBy(desc(events.id))
    .limit(limit)
  return rows.map((r) => ({
    ...r.e,
    actor_name: r.actor_name,
    actor_email: r.actor_email,
  }))
}

// Convenience: latest N events that the given user produced in a workspace.
// Used by the member achievements page in Phase 8.
export async function listMemberActivity(
  workspaceId: number,
  userId: number,
  limit = 50
): Promise<EventListItem[]> {
  const rows = await db
    .select({
      e: events,
      actor_name: users.name,
      actor_email: users.email,
    })
    .from(events)
    .leftJoin(users, eq(users.id, events.actor_user_id))
    .where(and(eq(events.workspace_id, workspaceId), eq(events.actor_user_id, userId)))
    .orderBy(desc(events.id))
    .limit(limit)
  return rows.map((r) => ({
    ...r.e,
    actor_name: r.actor_name,
    actor_email: r.actor_email,
  }))
}

// Suppress unused warning
void sql
