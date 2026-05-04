import { sql } from 'drizzle-orm'
import { db } from '../client'

export async function getAnalytics() {
  const issuesByStatus = (
    await db.execute(sql`
      SELECT status, COUNT(*)::int as count
      FROM issues
      GROUP BY status
      ORDER BY count DESC
    `)
  ).rows

  const issuesByProject = (
    await db.execute(sql`
      SELECT
        p.id,
        p.name,
        COUNT(i.id)::int as count
      FROM projects p
      LEFT JOIN issues i ON i.project_id = p.id
      GROUP BY p.id, p.name
      ORDER BY count DESC
      LIMIT 10
    `)
  ).rows

  const topAssignees = (
    await db.execute(sql`
      SELECT
        u.id,
        u.name,
        u.avatar_url,
        COUNT(i.id)::int as count
      FROM users u
      INNER JOIN issues i ON i.assignee_id = u.id
      GROUP BY u.id, u.name, u.avatar_url
      ORDER BY count DESC
      LIMIT 10
    `)
  ).rows

  const issuesOverTime = (
    await db.execute(sql`
      SELECT
        DATE(created_at) as date,
        COUNT(*)::int as count
      FROM issues
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `)
  ).rows

  return { issuesByStatus, issuesByProject, topAssignees, issuesOverTime }
}
