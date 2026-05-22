import { eq, sql } from 'drizzle-orm'
import { db } from '../client'
import { users } from '../schema'
import type { User } from '../schema'

export async function getUsers() {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatar_url: users.avatar_url,
    })
    .from(users)
    .orderBy(users.name)
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
  return rows[0] ?? null
}

export async function getUserById(id: number): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1)
  return rows[0] ?? null
}

export async function upsertUserFromOAuth(data: {
  google_id?: string
  email: string
  name?: string | null
  avatar_url?: string | null
}): Promise<{ user: User; was_new: boolean }> {
  // Inspect first to know whether this is a fresh signup, so the caller can
  // materialize pending invitations and other first-login side effects.
  const existing = await getUserByEmail(data.email)
  const was_new = !existing

  await db
    .insert(users)
    .values({
      google_id: data.google_id,
      email: data.email,
      name: data.name ?? undefined,
      avatar_url: data.avatar_url ?? undefined,
      last_login: new Date(),
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        name: data.name ?? undefined,
        avatar_url: data.avatar_url ?? undefined,
        last_login: new Date(),
      },
    })

  const final = await getUserByEmail(data.email)
  if (!final) throw new Error('upsert returned no user')
  return { user: final, was_new }
}

export async function createUserWithPassword(data: {
  email: string
  password_hash: string
  name?: string | null
}): Promise<User | null> {
  const [created] = await db
    .insert(users)
    .values({
      email: data.email,
      password_hash: data.password_hash,
      name: data.name ?? undefined,
      last_login: new Date(),
    })
    .returning()
  return created ?? null
}

export async function touchLastLogin(id: number): Promise<void> {
  await db.update(users).set({ last_login: new Date() }).where(eq(users.id, id))
}

export interface UpdateUserProfileInput {
  name?: string | null
  tagline?: string | null
  avatar_url?: string | null
}

// Soft-deletes the user: marks deleted_at, clears auth, revokes tokens.
// Returns the workspaces that *would* be hard-deleted (sole-owner with no
// other members) and the workspaces that block deletion (owner with members).
// If `confirm` is false, this is a dry run.
export interface DeleteAccountReport {
  blocked_by: Array<{ workspace_id: number; name: string; member_count: number }>
  will_hard_delete: Array<{ workspace_id: number; name: string }>
}

export async function deleteAccountReport(userId: number): Promise<DeleteAccountReport> {
  const rows = await db.execute<{
    workspace_id: number
    name: string
    member_count: number
  }>(sql`
    SELECT w.id AS workspace_id, w.name, COUNT(wm.id)::int AS member_count
    FROM workspaces w
    LEFT JOIN workspace_members wm ON wm.workspace_id = w.id
    WHERE w.owner_id = ${userId}
    GROUP BY w.id, w.name
  `)
  const blocked: DeleteAccountReport['blocked_by'] = []
  const willHardDelete: DeleteAccountReport['will_hard_delete'] = []
  for (const r of rows.rows) {
    if (r.member_count > 1) blocked.push(r)
    else willHardDelete.push({ workspace_id: r.workspace_id, name: r.name })
  }
  return { blocked_by: blocked, will_hard_delete: willHardDelete }
}

export async function softDeleteUser(userId: number): Promise<void> {
  await db.transaction(async (tx) => {
    // Hard-delete sole-owner workspaces (the cascade will sweep their content).
    await tx.execute(sql`
      DELETE FROM workspaces w
      WHERE w.owner_id = ${userId}
        AND (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = w.id) <= 1
    `)
    // Revoke tokens.
    await tx.execute(sql`DELETE FROM api_tokens WHERE user_id = ${userId}`)
    // Wipe inbox.
    await tx.execute(sql`DELETE FROM inbox_messages WHERE user_id = ${userId}`)
    // Soft delete the user row.
    await tx.execute(sql`
      UPDATE users SET
        deleted_at = now(),
        password_hash = NULL,
        google_id = NULL,
        active_workspace_id = NULL
      WHERE id = ${userId}
    `)
  })
}

export async function updateUserProfile(
  id: number,
  patch: UpdateUserProfileInput
): Promise<User | null> {
  const updates: Record<string, unknown> = {}
  if (patch.name !== undefined) updates.name = patch.name
  if (patch.tagline !== undefined) updates.tagline = patch.tagline
  if (patch.avatar_url !== undefined) updates.avatar_url = patch.avatar_url
  if (Object.keys(updates).length === 0) return getUserById(id)
  updates.updated_at = new Date()
  const [row] = await db.update(users).set(updates).where(eq(users.id, id)).returning()
  return row ?? null
}
