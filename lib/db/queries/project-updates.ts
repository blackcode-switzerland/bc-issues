// Project status updates ("health" feed). Each project has a chronological feed
// of updates; the most recent is the project's current health.

import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '../client'
import { projectUpdates, projects, users, type ProjectUpdate } from '../schema'
import { recordEvent } from './events'
import { toRichTextHtml } from '@/lib/rich-text'

export const PROJECT_UPDATE_STATUSES = ['on_track', 'at_risk', 'off_track'] as const
export type ProjectUpdateStatus = (typeof PROJECT_UPDATE_STATUSES)[number]

export interface ProjectUpdateListItem extends ProjectUpdate {
  author_name: string | null
  author_email: string | null
  author_avatar: string | null
}

export async function listProjectUpdates(
  projectId: number
): Promise<ProjectUpdateListItem[]> {
  const rows = await db
    .select({
      u: projectUpdates,
      author_name: users.name,
      author_email: users.email,
      author_avatar: users.avatar_url,
    })
    .from(projectUpdates)
    .leftJoin(users, eq(users.id, projectUpdates.author_id))
    .where(eq(projectUpdates.project_id, projectId))
    .orderBy(desc(projectUpdates.created_at), desc(projectUpdates.id))
  return rows.map((r) => ({
    ...r.u,
    author_name: r.author_name,
    author_email: r.author_email,
    author_avatar: r.author_avatar,
  }))
}

// Confirm the project exists in the workspace before mutating its updates.
export async function verifyProjectInWorkspace(
  workspaceId: number,
  projectId: number
): Promise<boolean> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(eq(projects.id, projectId), eq(projects.workspace_id, workspaceId), isNull(projects.deleted_at))
    )
    .limit(1)
  return !!rows[0]
}

export interface CreateProjectUpdateInput {
  workspaceId: number
  projectId: number
  userId: number
  status: ProjectUpdateStatus
  body: string | null
}

export async function createProjectUpdate(
  input: CreateProjectUpdateInput
): Promise<ProjectUpdate> {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(projectUpdates)
      .values({
        workspace_id: input.workspaceId,
        project_id: input.projectId,
        author_id: input.userId,
        status: input.status,
        body: toRichTextHtml(input.body),
      })
      .returning()
    if (!row) throw new Error('project update insert returned nothing')

    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      entityType: 'project',
      entityId: input.projectId,
      action: 'updated',
      meta: { project_update_id: row.id, health: input.status },
    })

    return row
  })
}

export async function deleteProjectUpdate(
  workspaceId: number,
  projectId: number,
  id: number,
  actorUserId: number
): Promise<boolean> {
  const before = await db
    .select()
    .from(projectUpdates)
    .where(
      and(
        eq(projectUpdates.id, id),
        eq(projectUpdates.project_id, projectId),
        eq(projectUpdates.workspace_id, workspaceId)
      )
    )
    .limit(1)
  if (!before[0]) return false
  // Only the author may delete their own update.
  if (before[0].author_id !== actorUserId) throw new Error('forbidden')
  const result = await db
    .delete(projectUpdates)
    .where(and(eq(projectUpdates.id, id), eq(projectUpdates.workspace_id, workspaceId)))
  return (result.rowCount ?? 0) > 0
}
