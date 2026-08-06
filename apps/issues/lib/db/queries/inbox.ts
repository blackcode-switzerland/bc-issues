// Inbox queries — user-scoped projection of events.
//
// createInboxMessage MUST be called inside the same transaction as the source
// event. This keeps the inbox consistent with activity.

import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { db } from '../client'
import { inboxMessages, type InboxMessage } from '../schema'
import {
  createInboxMessage as platformCreateInboxMessage,
  type CreateInboxInput,
} from '@blackcode/platform-db'
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '@/lib/limits'

type Tx = Pick<typeof db, 'insert' | 'select' | 'update' | 'delete' | 'execute'>

// The WRITE moved to @blackcode/platform-db on 2026-08-06 with the platform half
// of the event fan-out (docs/sales-app-plan.md D-23). `platform.inbox_messages`
// is a platform table and always was: being added to a workspace is not an
// issues fact, and a person invited from the sales deployment must see it in the
// same inbox. Re-exported here rather than re-pointed at the call sites, so the
// next person adding an inbox write still finds it in the file called `inbox`.
//
// Reading the inbox — everything below — did NOT move. It is Tier 2 and goes
// when `/api/me/inbox/*` becomes a shared route.
export type { CreateInboxInput }

export function createInboxMessage(tx: Tx, input: CreateInboxInput): Promise<InboxMessage> {
  return platformCreateInboxMessage(tx, input)
}

// ---------- listing / read state ----------

export interface ListInboxFilter {
  userId: number
  workspaceId?: number | null
  type?: string | null
  unreadOnly?: boolean
  includeArchived?: boolean
  archivedOnly?: boolean
  cursor?: number | null
  limit?: number
}

export interface InboxPage {
  data: InboxMessage[]
  next_cursor: number | null
  unread_count: number
}

const DEFAULT_LIMIT = PAGE_SIZE_DEFAULT
const MAX_LIMIT = PAGE_SIZE_MAX

export async function listInbox(filter: ListInboxFilter): Promise<InboxPage> {
  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const wheres = [eq(inboxMessages.user_id, filter.userId)]
  if (filter.archivedOnly) {
    wheres.push(isNotNull(inboxMessages.archived_at))
  } else if (!filter.includeArchived) {
    wheres.push(isNull(inboxMessages.archived_at))
  }
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

export async function unarchiveMessages(
  userId: number,
  ids: number[]
): Promise<number> {
  if (ids.length === 0) return 0
  const result = await db
    .update(inboxMessages)
    .set({ archived_at: null })
    .where(
      and(
        eq(inboxMessages.user_id, userId),
        inArray(inboxMessages.id, ids),
        isNotNull(inboxMessages.archived_at)
      )
    )
  return result.rowCount ?? 0
}
