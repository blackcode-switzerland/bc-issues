import { eq, sql } from 'drizzle-orm'
import { db } from '../client'
import { projects } from '../schema'
import type { Project } from '../schema'
import { addProjectMember } from './members'

export async function getProjects(userId?: number) {
  if (userId) {
    const result = await db.execute(sql`
      SELECT
        p.*,
        pm.role as member_role,
        COUNT(i.id)::int as issue_count,
        COUNT(i.id) FILTER (WHERE i.status NOT IN ('done', 'cancelled'))::int as open_issues
      FROM projects p
      INNER JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
      LEFT JOIN issues i ON i.project_id = p.id
      GROUP BY p.id, pm.role
      ORDER BY p.updated_at DESC
    `)
    return result.rows
  }

  const result = await db.execute(sql`
    SELECT
      p.*,
      COUNT(i.id)::int as issue_count,
      COUNT(i.id) FILTER (WHERE i.status NOT IN ('done', 'cancelled'))::int as open_issues
    FROM projects p
    LEFT JOIN issues i ON i.project_id = p.id
    GROUP BY p.id
    ORDER BY p.updated_at DESC
  `)
  return result.rows
}

export async function getProject(id: number): Promise<Project | null> {
  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1)
  return rows[0] ?? null
}

export async function createProject(data: {
  name: string
  description?: string
  owner_id?: number
}): Promise<Project | null> {
  const [created] = await db
    .insert(projects)
    .values({
      name: data.name,
      description: data.description,
      owner_id: data.owner_id,
    })
    .returning()

  if (created && data.owner_id) {
    await addProjectMember(created.id, data.owner_id, 'owner')
  }
  return created ?? null
}

export async function updateProject(
  id: number,
  data: Partial<{
    name: string
    description: string | null
    status: string
    priority: string
    visibility: string
    color: string
    icon_url: string | null
    banner_url: string | null
    start_date: string | null
    end_date: string | null
    owner_id: number | null
  }>
): Promise<Project | null> {
  const update: Record<string, unknown> = { updated_at: new Date() }
  for (const key of [
    'name',
    'description',
    'status',
    'priority',
    'visibility',
    'color',
    'icon_url',
    'banner_url',
    'start_date',
    'end_date',
    'owner_id',
  ] as const) {
    if (data[key] !== undefined) update[key] = data[key]
  }

  const [updated] = await db.update(projects).set(update).where(eq(projects.id, id)).returning()
  return updated ?? null
}

export async function deleteProject(id: number): Promise<void> {
  await db.delete(projects).where(eq(projects.id, id))
}

export interface ProjectsPage {
  data: unknown[]
  next_cursor: number | null
}

export async function getProjectsPage(opts: {
  user_id: number
  limit: number
  cursor?: number | null
}): Promise<ProjectsPage> {
  const { user_id, limit, cursor } = opts
  const filterCursor = cursor !== undefined && cursor !== null

  const result = await db.execute(sql`
    SELECT
      p.*,
      pm.role as member_role,
      COUNT(i.id)::int as issue_count,
      COUNT(i.id) FILTER (WHERE i.status NOT IN ('done', 'cancelled'))::int as open_issues
    FROM projects p
    INNER JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${user_id}
    LEFT JOIN issues i ON i.project_id = p.id
    WHERE 1=1
      ${filterCursor ? sql`AND p.id < ${cursor}` : sql``}
    GROUP BY p.id, pm.role
    ORDER BY p.id DESC
    LIMIT ${limit + 1}
  `)

  const rows = result.rows as Array<{ id: number }>
  const has_more = rows.length > limit
  const data = has_more ? rows.slice(0, limit) : rows
  const next_cursor = has_more ? data[data.length - 1].id : null
  return { data, next_cursor }
}
