// Inbox queries — user-scoped projection of events.
//
// createInboxMessage MUST be called inside the same transaction as the source
// event when possible. This keeps the inbox consistent with activity.
//
// 60-second dedup: if a message of the same (user_id, entity_type, entity_id,
// type) was created in the last 60s, we update its payload and bump created_at
// rather than inserting a new row. This collapses rapid status flips into one
// notification.

import { and, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm'
import { db } from '../client'
import {
  inboxMessages,
  type InboxMessage,
  type NewInboxMessage,
} from '../schema'

const DEDUP_WINDOW_MS = 60_000

type Tx = Pick<typeof db, 'insert' | 'select' | 'update' | 'delete' | 'execute'>

export interface CreateInboxInput {
  userId: number
  eventId?: number | null
  workspaceId?: number | null
  type: string
  entityType?: string | null
  entityId?: number | null
  actorUserId?: number | null
  payload: Record<string, unknown>
}

export async function createInboxMessage(
  tx: Tx,
  input: CreateInboxInput
): Promise<InboxMessage> {
  // Try to find a recent matching message to dedup against.
  if (input.entityType && input.entityId != null) {
    const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS)
    const existing = await tx
      .select({ id: inboxMessages.id })
      .from(inboxMessages)
      .where(
        and(
          eq(inboxMessages.user_id, input.userId),
          eq(inboxMessages.type, input.type),
          eq(inboxMessages.entity_type, input.entityType),
          eq(inboxMessages.entity_id, input.entityId),
          gt(inboxMessages.created_at, cutoff),
          isNull(inboxMessages.archived_at)
        )
      )
      .orderBy(desc(inboxMessages.id))
      .limit(1)
    if (existing[0]) {
      const [row] = await tx
        .update(inboxMessages)
        .set({
          payload: input.payload,
          created_at: new Date(),
          read_at: null,
          actor_user_id: input.actorUserId ?? null,
          event_id: input.eventId ?? null,
          workspace_id: input.workspaceId ?? null,
        })
        .where(eq(inboxMessages.id, existing[0].id))
        .returning()
      if (row) return row
    }
  }

  const values: NewInboxMessage = {
    user_id: input.userId,
    event_id: input.eventId ?? null,
    workspace_id: input.workspaceId ?? null,
    type: input.type,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    actor_user_id: input.actorUserId ?? null,
    payload: input.payload,
  }
  const [row] = await tx.insert(inboxMessages).values(values).returning()
  if (!row) throw new Error('inbox insert returned nothing')
  return row
}

// ---------- listing / read state ----------

export interface ListInboxFilter {
  userId: number
  workspaceId?: number | null
  type?: string | null
  unreadOnly?: boolean
  includeArchived?: boolean
  cursor?: number | null
  limit?: number
}

export interface InboxPage {
  data: InboxMessage[]
  next_cursor: number | null
  unread_count: number
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function listInbox(filter: ListInboxFilter): Promise<InboxPage> {
  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const wheres = [eq(inboxMessages.user_id, filter.userId)]
  if (!filter.includeArchived) wheres.push(isNull(inboxMessages.archived_at))
  if (filter.workspaceId != null) wheres.push(eq(inboxMessages.workspace_id, filter.workspaceId))
  if (filter.type) wheres.push(eq(inboxMessages.type, filter.type))
  if (filter.unreadOnly) wheres.push(isNull(inboxMessages.read_at))
  if (filter.cursor) wheres.push(lt(inboxMessages.id, filter.cursor))

  const rows = await db
    .select()
    .from(inboxMessages)
    .where(and(...wheres))
    .orderBy(desc(inboxMessages.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const data = rows.slice(0, limit)
  const next_cursor = hasMore ? data[data.length - 1].id : null

  const unread = await countUnread(filter.userId, filter.workspaceId ?? undefined)

  return { data, next_cursor, unread_count: unread }
}

export async function countUnread(userId: number, workspaceId?: number): Promise<number> {
  const wheres = [
    eq(inboxMessages.user_id, userId),
    isNull(inboxMessages.read_at),
    isNull(inboxMessages.archived_at),
  ]
  if (workspaceId !== undefined) wheres.push(eq(inboxMessages.workspace_id, workspaceId))
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inboxMessages)
    .where(and(...wheres))
  return rows[0]?.count ?? 0
}

export async function markRead(
  userId: number,
  options: { ids?: number[]; all?: boolean; workspaceId?: number }
): Promise<number> {
  const wheres = [eq(inboxMessages.user_id, userId), isNull(inboxMessages.read_at)]
  if (options.ids && options.ids.length > 0) wheres.push(inArray(inboxMessages.id, options.ids))
  else if (!options.all) return 0
  if (options.workspaceId !== undefined) wheres.push(eq(inboxMessages.workspace_id, options.workspaceId))
  const result = await db
    .update(inboxMessages)
    .set({ read_at: new Date() })
    .where(and(...wheres))
  return result.rowCount ?? 0
}

export async function archiveMessages(
  userId: number,
  ids: number[]
): Promise<number> {
  if (ids.length === 0) return 0
  const result = await db
    .update(inboxMessages)
    .set({ archived_at: new Date() })
    .where(
      and(
        eq(inboxMessages.user_id, userId),
        inArray(inboxMessages.id, ids),
        isNull(inboxMessages.archived_at)
      )
    )
  return result.rowCount ?? 0
}
