// Project ↔ member associations.
//
// Project members are a *list of people working on the project* (a subset of
// the workspace), distinct from workspace access (which stays workspace-level).
// We reuse the project_members table for this list.

import { eq } from 'drizzle-orm'
import { db } from '../client'
import {
  projectMembers,
  users,
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

