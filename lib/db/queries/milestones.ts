import { eq, sql } from 'drizzle-orm'
import { db } from '../client'
import { milestones } from '../schema'
import type { Milestone } from '../schema'

export async function getMilestones(projectId: number) {
  const result = await db.execute(sql`
    SELECT
      m.*,
      COUNT(i.id)::int as issue_count,
      COUNT(i.id) FILTER (WHERE i.status = 'done')::int as completed_issues
    FROM milestones m
    LEFT JOIN issues i ON i.milestone_id = m.id
    WHERE m.project_id = ${projectId}
    GROUP BY m.id
    ORDER BY m.due_date ASC NULLS LAST
  `)
  return result.rows
}

export async function getAllMilestones() {
  const result = await db.execute(sql`
    SELECT
      m.*,
      p.name as project_name,
      COUNT(i.id)::int as issue_count,
      COUNT(i.id) FILTER (WHERE i.status = 'done')::int as completed_issues
    FROM milestones m
    LEFT JOIN projects p ON p.id = m.project_id
    LEFT JOIN issues i ON i.milestone_id = m.id
    GROUP BY m.id, p.name
    ORDER BY m.due_date ASC NULLS LAST
  `)
  return result.rows
}

export async function getMilestone(id: number): Promise<Milestone | null> {
  const rows = await db.select().from(milestones).where(eq(milestones.id, id)).limit(1)
  return rows[0] ?? null
}

export async function getMilestoneWithDetails(id: number) {
  const result = await db.execute(sql`
    SELECT
      m.*,
      p.name as project_name,
      COUNT(i.id)::int as issue_count,
      COUNT(i.id) FILTER (WHERE i.status = 'done')::int as completed_issues
    FROM milestones m
    LEFT JOIN projects p ON p.id = m.project_id
    LEFT JOIN issues i ON i.milestone_id = m.id
    WHERE m.id = ${id}
    GROUP BY m.id, p.name
  `)
  return result.rows[0] ?? null
}

export async function createMilestone(data: {
  project_id: number
  name: string
  description?: string
  due_date?: string
}) {
  const [created] = await db
    .insert(milestones)
    .values({
      project_id: data.project_id,
      name: data.name,
      description: data.description,
      due_date: data.due_date,
    })
    .returning()
  return created ?? null
}

export async function updateMilestone(
  id: number,
  data: Partial<{ name: string; description: string | null; due_date: string | null }>
) {
  const update: Record<string, unknown> = { updated_at: new Date() }
  for (const key of ['name', 'description', 'due_date'] as const) {
    if (data[key] !== undefined) update[key] = data[key]
  }
  const [updated] = await db.update(milestones).set(update).where(eq(milestones.id, id)).returning()
  return updated ?? null
}

export async function deleteMilestone(id: number) {
  await db.delete(milestones).where(eq(milestones.id, id))
}
