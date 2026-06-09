// Project ↔ member and project ↔ label associations.
//
// Project members are a *list of people working on the project* (a subset of
// the workspace), distinct from workspace access (which stays workspace-level).
// We reuse the project_members table for this list. Project labels reuse the
// workspace-scoped labels table via project_labels.

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../client'
import {
  labels,
  projectLabels,
  projectMembers,
  users,
  type Label,
} from '../schema'

type Tx = Pick<typeof db, 'insert' | 'select' | 'update' | 'delete'>

// ---- members ----

export interface ProjectMemberRow {
  user_id: number
  email: string
  name: string | null
  avatar_url: string | null
}

export async function listProjectMembers(projectId: number): Promise<ProjectMemberRow[]> {
  return await db
    .select({
      user_id: projectMembers.user_id,
      email: users.email,
      name: users.name,
      avatar_url: users.avatar_url,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.user_id))
    .where(eq(projectMembers.project_id, projectId))
    .orderBy(users.name)
}

// Replace the project's member list with exactly `userIds`.
export async function setProjectMembers(
  tx: Tx,
  projectId: number,
  userIds: number[]
): Promise<void> {
  await tx.delete(projectMembers).where(eq(projectMembers.project_id, projectId))
  if (userIds.length === 0) return
  const unique = Array.from(new Set(userIds))
  await tx
    .insert(projectMembers)
    .values(unique.map((uid) => ({ project_id: projectId, user_id: uid, role: 'member' })))
    .onConflictDoNothing()
}

// ---- labels ----

export async function listProjectLabels(projectId: number): Promise<Label[]> {
  return await db
    .select({
      id: labels.id,
      workspace_id: labels.workspace_id,
      name: labels.name,
      color: labels.color,
      description: labels.description,
      created_by: labels.created_by,
      created_at: labels.created_at,
    })
    .from(projectLabels)
    .innerJoin(labels, eq(labels.id, projectLabels.label_id))
    .where(eq(projectLabels.project_id, projectId))
    .orderBy(labels.name)
}

// Replace the project's labels with exactly `labelIds` (scoped to the
// workspace's labels — invalid ids are ignored by the FK).
export async function setProjectLabels(
  tx: Tx,
  projectId: number,
  workspaceId: number,
  labelIds: number[]
): Promise<void> {
  await tx.delete(projectLabels).where(eq(projectLabels.project_id, projectId))
  if (labelIds.length === 0) return
  // Only attach labels that belong to this workspace.
  const valid = await tx
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.workspace_id, workspaceId), inArray(labels.id, labelIds)))
  if (valid.length === 0) return
  await tx
    .insert(projectLabels)
    .values(valid.map((l) => ({ project_id: projectId, label_id: l.id })))
    .onConflictDoNothing()
}
