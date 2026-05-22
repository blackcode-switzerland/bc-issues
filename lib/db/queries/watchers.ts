// Issue watchers. Three reasons:
//   - 'reporter'  — auto-set on issue create
//   - 'assigned'  — auto-set on assignment, removed on unassign
//   - 'manual'    — explicit `bk issue watch` / Watch button. Sticky: not
//                   removed when other conditions go away.
//
// If a user already has a row for the issue with reason='manual', a new
// 'assigned' watch does NOT overwrite it. Conversely, unassign only removes
// 'assigned' watchers.

import { and, eq } from 'drizzle-orm'
import { db } from '../client'
import { issueWatchers, type IssueWatcher } from '../schema'

type Tx = Pick<typeof db, 'insert' | 'select' | 'update' | 'delete' | 'execute'>

export type WatcherReason = 'manual' | 'assigned' | 'reporter'

export async function addWatcher(
  tx: Tx,
  issueId: number,
  userId: number,
  reason: WatcherReason
): Promise<void> {
  await tx
    .insert(issueWatchers)
    .values({ issue_id: issueId, user_id: userId, reason })
    .onConflictDoNothing({ target: [issueWatchers.issue_id, issueWatchers.user_id] })
}

export async function removeAutoWatcher(
  tx: Tx,
  issueId: number,
  userId: number,
  reason: 'assigned' | 'reporter'
): Promise<void> {
  await tx
    .delete(issueWatchers)
    .where(
      and(
        eq(issueWatchers.issue_id, issueId),
        eq(issueWatchers.user_id, userId),
        eq(issueWatchers.reason, reason)
      )
    )
}

export async function removeWatcher(
  tx: Tx,
  issueId: number,
  userId: number
): Promise<void> {
  await tx
    .delete(issueWatchers)
    .where(and(eq(issueWatchers.issue_id, issueId), eq(issueWatchers.user_id, userId)))
}

export async function listWatchers(issueId: number): Promise<IssueWatcher[]> {
  return await db
    .select()
    .from(issueWatchers)
    .where(eq(issueWatchers.issue_id, issueId))
}

export async function listWatcherUserIds(tx: Tx, issueId: number): Promise<number[]> {
  const rows = await tx
    .select({ user_id: issueWatchers.user_id })
    .from(issueWatchers)
    .where(eq(issueWatchers.issue_id, issueId))
  return rows.map((r) => r.user_id)
}
