// Per-issue activity: the comments on an issue, newest first.
//
// This used to UNION a second half read from `platform.transaction_log`, the
// table behind the old `bk undo`. That table was never written — `logTransaction`
// had no callers — so the "changes" half returned an empty list on every call
// this feature has ever served. It went with `bk undo` in 1.12.0; the real
// history is `platform.events` (see queries/events.ts), which the activity feed
// and inbox already read.

import { sql } from 'drizzle-orm'
import { comments, users } from '../schema'
import { db } from '../client'
import { ownTypeIn } from './qualified-type'

export async function getIssueActivity(issueId: number) {
  const commentRows = (
    await db.execute(sql`
      SELECT
        c.id,
        'comment' as type,
        c.content,
        c.user_id,
        u.name as user_name,
        u.avatar_url as user_avatar,
        c.created_at
      FROM ${comments} c
      LEFT JOIN ${users} u ON u.id = c.user_id
      WHERE c.parent_type IN ${ownTypeIn('issue')} AND c.parent_id = ${issueId}
      ORDER BY c.created_at DESC
    `)
  ).rows

  return [...commentRows].sort(
    (a, b) =>
      new Date((b as { created_at: string }).created_at).getTime() -
      new Date((a as { created_at: string }).created_at).getTime()
  )
}
