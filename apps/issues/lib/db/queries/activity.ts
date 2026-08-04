import { sql } from 'drizzle-orm'
import { comments, transactionLog, users } from '../schema'
import { db } from '../client'

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
      WHERE c.parent_type = 'issue' AND c.parent_id = ${issueId}
      ORDER BY c.created_at DESC
    `)
  ).rows

  const changes = (
    await db.execute(sql`
      SELECT
        t.id,
        'change' as type,
        t.operation_type,
        t.old_data,
        t.new_data,
        t.user_id,
        u.name as user_name,
        u.avatar_url as user_avatar,
        t.created_at
      FROM ${transactionLog} t
      LEFT JOIN ${users} u ON u.id = t.user_id
      WHERE t.table_name = 'issues' AND t.record_id = ${issueId}
      ORDER BY t.created_at DESC
      LIMIT 50
    `)
  ).rows

  return [...commentRows, ...changes].sort(
    (a, b) =>
      new Date((b as { created_at: string }).created_at).getTime() -
      new Date((a as { created_at: string }).created_at).getTime()
  )
}
