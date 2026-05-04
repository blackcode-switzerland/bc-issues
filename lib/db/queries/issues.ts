import { eq, sql } from 'drizzle-orm'
import { db } from '../client'
import { issues } from '../schema'
import type { Issue } from '../schema'

const issueWithRelations = sql`
  i.*,
  u.name as assignee_name,
  u.avatar_url as assignee_avatar,
  m.name as milestone_name,
  (SELECT COUNT(*)::int FROM comments c WHERE c.issue_id = i.id) as comment_count,
  (SELECT COUNT(*)::int FROM attachments a WHERE a.issue_id = i.id) as attachment_count
`

export type IssueRow = Issue & {
  assignee_name?: string | null
  assignee_avatar?: string | null
  milestone_name?: string | null
  comment_count?: number
  attachment_count?: number
  project_name?: string | null
}

export async function getIssue(id: number): Promise<IssueRow | null> {
  const result = await db.execute(sql`
    SELECT ${issueWithRelations}
    FROM issues i
    LEFT JOIN users u ON u.id = i.assignee_id
    LEFT JOIN milestones m ON m.id = i.milestone_id
    WHERE i.id = ${id}
  `)
  return (result.rows[0] as IssueRow | undefined) ?? null
}

export async function getIssuesByProject(projectId: number) {
  const result = await db.execute(sql`
    SELECT ${issueWithRelations}
    FROM issues i
    LEFT JOIN users u ON u.id = i.assignee_id
    LEFT JOIN milestones m ON m.id = i.milestone_id
    WHERE i.project_id = ${projectId}
    ORDER BY i.priority ASC, i.updated_at DESC
  `)
  return result.rows
}

export async function getAllIssuesWithProjects() {
  const result = await db.execute(sql`
    SELECT
      ${issueWithRelations},
      p.name as project_name
    FROM issues i
    LEFT JOIN users u ON u.id = i.assignee_id
    LEFT JOIN milestones m ON m.id = i.milestone_id
    LEFT JOIN projects p ON p.id = i.project_id
    ORDER BY i.priority ASC, i.updated_at DESC
  `)
  return result.rows
}

export interface IssuePage {
  data: unknown[]
  next_cursor: number | null
}

export async function getIssuesPage(opts: {
  project_id?: number
  limit: number
  cursor?: number | null
}): Promise<IssuePage> {
  const { project_id, limit, cursor } = opts
  const filterProject = project_id !== undefined
  const filterCursor = cursor !== undefined && cursor !== null

  const result = await db.execute(sql`
    SELECT
      ${issueWithRelations},
      p.name as project_name
    FROM issues i
    LEFT JOIN users u ON u.id = i.assignee_id
    LEFT JOIN milestones m ON m.id = i.milestone_id
    LEFT JOIN projects p ON p.id = i.project_id
    WHERE 1=1
      ${filterProject ? sql`AND i.project_id = ${project_id}` : sql``}
      ${filterCursor ? sql`AND i.id < ${cursor}` : sql``}
    ORDER BY i.id DESC
    LIMIT ${limit + 1}
  `)

  const rows = result.rows as Array<{ id: number }>
  const has_more = rows.length > limit
  const data = has_more ? rows.slice(0, limit) : rows
  const next_cursor = has_more ? data[data.length - 1].id : null
  return { data, next_cursor }
}

export async function getIssuesByMilestone(milestoneId: number) {
  const result = await db.execute(sql`
    SELECT
      ${issueWithRelations},
      p.name as project_name
    FROM issues i
    LEFT JOIN users u ON u.id = i.assignee_id
    LEFT JOIN milestones m ON m.id = i.milestone_id
    LEFT JOIN projects p ON p.id = i.project_id
    WHERE i.milestone_id = ${milestoneId}
    ORDER BY i.priority ASC, i.updated_at DESC
  `)
  return result.rows
}

export async function createIssue(data: {
  project_id: number
  title: string
  description?: string
  status?: string
  priority?: number
  assignee_id?: number
  milestone_id?: number
  reporter_id?: number
}): Promise<Issue | null> {
  const [created] = await db
    .insert(issues)
    .values({
      project_id: data.project_id,
      title: data.title,
      description: data.description,
      status: data.status ?? 'backlog',
      priority: data.priority ?? 3,
      assignee_id: data.assignee_id,
      milestone_id: data.milestone_id,
      reporter_id: data.reporter_id,
    })
    .returning()
  return created ?? null
}

export async function updateIssue(
  id: number,
  data: Partial<{
    title: string
    description: string | null
    status: string
    priority: number
    assignee_id: number | null
    milestone_id: number | null
    start_date: string | null
    due_date: string | null
  }>
): Promise<Issue | null> {
  const update: Record<string, unknown> = { updated_at: new Date() }
  for (const key of [
    'title',
    'description',
    'status',
    'priority',
    'assignee_id',
    'milestone_id',
    'start_date',
    'due_date',
  ] as const) {
    if (data[key] !== undefined) update[key] = data[key]
  }
  const [updated] = await db.update(issues).set(update).where(eq(issues.id, id)).returning()
  return updated ?? null
}

export async function deleteIssue(id: number) {
  await db.delete(issues).where(eq(issues.id, id))
}

export async function getKanbanView(projectId: number) {
  const rows = await getIssuesByProject(projectId)
  const kanban: Record<string, unknown[]> = {
    backlog: [],
    todo: [],
    in_progress: [],
    blocked: [],
    in_review: [],
    done: [],
  }
  for (const r of rows as Array<{ status: string }>) {
    if (kanban[r.status]) kanban[r.status].push(r)
    else kanban.backlog.push(r)
  }
  return kanban
}
