// events queries — the spine of activity, inbox, analytics.
//
// recordEvent MUST be called inside the transaction that produces the
// mutation. The application layer is the only place where events are
// invented; the database does not have triggers (deliberate — see §1.4).
//
// The transaction handle is typed as `Tx` (a subset of the Drizzle interface).
// Both `db` and `tx` satisfy it.
//
// ---------------------------------------------------------------------------
// THIS RECORDER OWNS THIS APP'S ENTITY TYPES, NOT ALL OF THEM
// ---------------------------------------------------------------------------
// Since 2026-08-06 (docs/sales-app-plan.md D-23), an event about a workspace, a
// membership, an app grant or an invitation is written by `recordPlatformEvent`
// in @blackcode/platform-db, which this function delegates to. Nothing about a
// call site changes — the delegation is below, in one place.
//
// Everything the app half does to an event, the platform half has no use for: a
// `subject_urn` resolved from this app's tables (null for every platform entity
// type, decided before a query runs) and a fan-out written in this app's nouns.
// So the two halves are not the same function with a flag, and the split is not
// a layering exercise: it is what lets a workspace created from the sales
// deployment record a SALES event without sales owning a copy of this file.

import { and, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm'
import { db } from '../client'
import { events, users, issues, tasks, projects, type Event, type NewEvent } from '../schema'
import { fanOutEvent } from './fanout'
import {
  isPlatformEntityType,
  listEvents as platformListEvents,
  recordPlatformEvent,
  type EventsPage,
  type EventListItem,
  type ListEventsFilter as PlatformListEventsFilter,
  type PlatformEventAction,
  type PlatformEntityType,
} from '@blackcode/platform-db'
import { resolveSubjectUrn } from './entities'
import { APP_SLUG } from '@/lib/app'
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '@/lib/limits'

// The platform half of each vocabulary is IMPORTED, not restated (D-23). The
// same two lists are what `recordPlatformEvent` will accept and what the
// activity route validates `?entity_type=` / `?action=` against, so a third copy
// here would be a third thing to keep in step — and the way that fails is
// invisible: the activity route drops an unrecognised filter instead of
// rejecting it, and returns the whole feed.
export type EntityType =
  | PlatformEntityType
  | 'project'
  | 'task'
  | 'issue'
  | 'comment'
  | 'attachment'
  | 'label'

export type EventAction =
  | PlatformEventAction
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
  // When set, consecutive events of the same (entity, actor, action) recorded
  // within this many milliseconds are merged into the existing row instead of
  // inserting a new one. Used to collapse autosave-driven `updated` storms in
  // the activity feed. Only safe for actions that do NOT fan out to the inbox.
  coalesceWindowMs?: number
  // Override the cross-app subject address. Leave unset and recordEvent derives
  // it from (entityType, entityId) — which is what every call site should do.
  // Pass it explicitly only when the subject row is already gone by the time the
  // event is recorded (a purge), because then there is nothing left to derive it
  // from. Pass `null` to state that this event has no addressable subject.
  subjectUrn?: string | null
}

type Tx = Pick<typeof db, 'insert' | 'select' | 'update' | 'delete' | 'execute'>

// How long consecutive `updated` edits by the same actor on the same entity are
// collapsed into one activity row. Long enough to absorb an editing session
// (autosave fires every ~1.2s while typing), short enough that returning to an
// item hours later reads as a distinct edit.
export const UPDATE_COALESCE_WINDOW_MS = 10 * 60 * 1000

// Merge two diff snapshots so the coalesced row keeps the *earliest* `before`
// value and the *latest* `after` value for every field touched across the run.
function mergeDiff(
  existing: { before?: unknown; after?: unknown } | null,
  next: { before?: unknown; after?: unknown } | null
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
  const exBefore = isRecord(existing?.before) ? existing!.before : {}
  const exAfter = isRecord(existing?.after) ? existing!.after : {}
  const nxBefore = isRecord(next?.before) ? next!.before : {}
  const nxAfter = isRecord(next?.after) ? next!.after : {}
  // before: keep the existing (older) value for keys already seen; otherwise
  // take this edit's before value as the new baseline for that field.
  const before: Record<string, unknown> = { ...nxBefore, ...exBefore }
  // after: the latest edit wins per field.
  const after: Record<string, unknown> = { ...exAfter, ...nxAfter }
  return { before, after }
}

export async function recordEvent(tx: Tx, input: RecordEventInput): Promise<Event> {
  // The platform half (D-23). Delegated here rather than at the call sites, for
  // the same reason `subject_urn` is resolved here rather than at the ~40 of
  // them: one place to be right beats forty places to remember.
  //
  // `app: APP_SLUG` is what makes `platform.events.app` the PRODUCING app —
  // this deployment is the issues app, so a workspace created through it is an
  // issues event even though a workspace belongs to no app. The same code
  // compiled into sales records a sales event. Never hardcode a slug here.
  if (isPlatformEntityType(input.entityType)) {
    // Neither of these is supported on the platform side, and both would be
    // dropped in silence otherwise. No call site passes either today; this
    // exists so that the day one does, it says so.
    if (input.coalesceWindowMs || input.subjectUrn !== undefined) {
      throw new Error(
        `recordEvent: '${input.entityType}' is a platform entity type (D-23), and ` +
          'recordPlatformEvent supports neither coalesceWindowMs nor an explicit ' +
          'subjectUrn. Coalescing is only safe for actions that do not reach the ' +
          'inbox, and a platform event has no cross-app subject to address. If one ' +
          'of these is genuinely needed, add it there rather than around this check.'
      )
    }
    return recordPlatformEvent(tx, {
      app: APP_SLUG,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      actorTokenId: input.actorTokenId,
      entityType: input.entityType as PlatformEntityType,
      entityId: input.entityId,
      action: input.action as PlatformEventAction,
      diff: input.diff,
      meta: input.meta,
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.occurredAt,
    })
  }

  if (input.coalesceWindowMs && input.coalesceWindowMs > 0 && input.actorUserId != null) {
    const occurredAt = input.occurredAt ?? new Date()
    const windowStart = new Date(occurredAt.getTime() - input.coalesceWindowMs)
    const [prev] = await tx
      .select()
      .from(events)
      .where(
        and(
          eq(events.workspace_id, input.workspaceId),
          eq(events.entity_type, input.entityType),
          eq(events.entity_id, input.entityId),
          eq(events.actor_user_id, input.actorUserId),
          eq(events.action, input.action),
          gte(events.occurred_at, windowStart)
        )
      )
      .orderBy(desc(events.id))
      .limit(1)
    if (prev) {
      const [merged] = await tx
        .update(events)
        .set({
          diff: mergeDiff(
            prev.diff as { before?: unknown; after?: unknown } | null,
            input.diff ?? null
          ),
          meta: { ...(prev.meta as object | null), ...(input.meta ?? {}) },
          occurred_at: occurredAt,
        })
        .where(eq(events.id, prev.id))
        .returning()
      if (!merged) throw new Error('event coalesce update returned nothing')
      return merged
    }
  }
  // The cross-app half of the event (Phase 6), resolved here rather than at the
  // ~40 call sites. `app` is the PRODUCING app — a workspace or member event
  // recorded by this deployment is an issues-app event, because that is what
  // wrote it. `subject_urn` is null for subjects that are not projected
  // entities, which is an answer, not a gap.
  const subjectUrn =
    input.subjectUrn !== undefined
      ? input.subjectUrn
      : await resolveSubjectUrn(tx, input.workspaceId, input.entityType, input.entityId)

  const values: NewEvent = {
    workspace_id: input.workspaceId,
    app: APP_SLUG,
    subject_urn: subjectUrn,
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
  /** Restrict to events produced by these apps (Phase 6). */
  apps?: string[]
  /** Restrict to events about one cross-app subject. */
  subjectUrn?: string
  fromOccurredAt?: Date
  toOccurredAt?: Date
  cursor?: number | null // event id
  limit?: number // default 50, max 200
}

// Aliased, not redeclared: the shapes are the platform ones now, and two
// identical declarations are two things to keep in step.
export type { EventListItem, EventsPage }

const DEFAULT_LIMIT = PAGE_SIZE_DEFAULT
const MAX_LIMIT = PAGE_SIZE_MAX

// Moved to @blackcode/platform-db on 2026-08-06 with
// GET /api/workspaces/{ws}/activity, now a Class-B shared factory
// (docs/sales-app-plan.md D-22). It reads platform.events + platform.users and
// nothing else. WRITING an event — recordEvent below — did not move: it resolves
// a subject URN from this app's tables and fans out through this app's rules.
export function listEvents(filter: ListEventsFilter): Promise<EventsPage> {
  return platformListEvents(db, filter as PlatformListEventsFilter)
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
