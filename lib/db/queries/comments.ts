import { sql } from 'drizzle-orm'
import { db } from '../client'
import { comments } from '../schema'

export async function getComments(issueId: number) {
  const result = await db.execute(sql`
    SELECT
      c.*,
      u.name as author_name,
      u.avatar_url as author_avatar
    FROM comments c
    LEFT JOIN users u ON u.id = c.user_id
    WHERE c.issue_id = ${issueId}
    ORDER BY c.created_at ASC
  `)
  return result.rows
}

export async function createComment(data: {
  issue_id: number
  user_id: number
  content: string
}) {
  const [created] = await db
    .insert(comments)
    .values({ issue_id: data.issue_id, user_id: data.user_id, content: data.content })
    .returning()
  return created ?? null
}
