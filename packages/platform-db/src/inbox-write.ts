// Writing `platform.inbox_messages` — the per-user projection of an event.
//
// Moved from `apps/issues/lib/db/queries/inbox.ts` on 2026-08-06 with the
// platform half of the event fan-out (docs/sales-app-plan.md D-23). The table is
// platform's and always was: an inbox row about being added to a workspace is
// not an issues fact, and a person invited from the sales app must see it in the
// same inbox.
//
// Only the WRITE moved. Reading the inbox (`listInbox`, `countUnread`,
// `markRead`, …) is Tier 2 and still lives in the app; it moves with
// `/api/me/inbox/*` when that route is shared.
//
// createInboxMessage MUST be called inside the same transaction as the source
// event. That is what keeps the inbox consistent with the activity feed: a
// rolled-back mutation takes its notification with it.

import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import type { PlatformTx } from './client'
import { inboxMessages, type InboxMessage, type NewInboxMessage } from './schema'

// If a message of the same (user_id, entity_type, entity_id, type) was created
// in the last 60s, update its payload and bump created_at rather than inserting
// a second row. This collapses rapid status flips into one notification.
const DEDUP_WINDOW_MS = 60_000

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
  tx: PlatformTx,
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
