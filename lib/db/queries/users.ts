import { eq } from 'drizzle-orm'
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
      role: users.role,
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
}): Promise<void> {
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
