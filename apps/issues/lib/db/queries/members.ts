import { and, eq, sql } from 'drizzle-orm'
import { db } from '../client'
import { projectMembers } from '../schema'

export async function getProjectMembers(projectId: number) {
  const result = await db.execute(sql`
    SELECT
      pm.*,
      u.name,
      u.email,
      u.avatar_url
    FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    WHERE pm.project_id = ${projectId}
    ORDER BY pm.role, u.name
  `)
  return result.rows
}

export async function addProjectMember(projectId: number, userId: number, role: string = 'member') {
  const [row] = await db
    .insert(projectMembers)
    .values({ project_id: projectId, user_id: userId, role })
    .onConflictDoUpdate({
      target: [projectMembers.project_id, projectMembers.user_id],
      set: { role },
    })
    .returning()
  return row ?? null
}

export async function removeProjectMember(projectId: number, userId: number) {
  await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.project_id, projectId), eq(projectMembers.user_id, userId)))
}

export async function isProjectMember(projectId: number, userId: number): Promise<boolean> {
  const rows = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(and(eq(projectMembers.project_id, projectId), eq(projectMembers.user_id, userId)))
    .limit(1)
  return rows.length > 0
}

export async function getProjectMemberRole(
  projectId: number,
  userId: number
): Promise<string | null> {
  const rows = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.project_id, projectId), eq(projectMembers.user_id, userId)))
    .limit(1)
  return rows[0]?.role ?? null
}
