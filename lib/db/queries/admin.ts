import { db } from '@/lib/db/client'
import { users, workspaceMembers } from '@/lib/db/schema'
import { sql, isNull, eq, desc } from 'drizzle-orm'

export async function listAllPlatformUsers() {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatar_url: users.avatar_url,
      created_at: users.created_at,
      last_login: users.last_login,
      workspace_count: sql<number>`count(distinct ${workspaceMembers.workspace_id})::int`,
    })
    .from(users)
    .leftJoin(workspaceMembers, eq(workspaceMembers.user_id, users.id))
    .where(isNull(users.deleted_at))
    .groupBy(users.id)
    .orderBy(desc(users.created_at))
}
