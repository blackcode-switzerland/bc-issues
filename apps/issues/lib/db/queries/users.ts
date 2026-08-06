import { eq, sql } from 'drizzle-orm'
import { db } from '../client'
import {
  deleteAccountReport as platformDeleteAccountReport,
  getUserById as platformGetUserById,
  getVisibleUsers as platformGetVisibleUsers,
  softDeleteUser as platformSoftDeleteUser,
  updateUserProfile as platformUpdateUserProfile,
  type DeleteAccountReport,
  type UpdateUserProfileInput,
} from '@blackcode/platform-db'
import { apiTokens, inboxMessages, users, workspaceMembers, workspaces } from '../schema'
import type { User } from '../schema'

// DEPRECATED: returns every user on the platform. Do not expose to end users —
// it leaks the global directory. Use getVisibleUsers(callerId) instead. Kept
// only for internal/admin tooling that genuinely needs the full list.
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

// Privacy guard: the directory a given user is allowed to see. Returns only
// non-deleted users who share at least one workspace with the caller (which
// includes the caller themselves). This is the professional model — you can
// only discover people you already collaborate with. Inviting brand-new people
// is done blind, by email.
// Moved to @blackcode/platform-db on 2026-08-06 with GET /api/users, which is
// now a shared route factory (docs/sales-app-plan.md Phase 1b). It reads only
// platform.users and platform.workspace_members. Bound to this app's `db` here
// so every existing call site is unchanged.
export function getVisibleUsers(callerId: number) {
  return platformGetVisibleUsers(db, callerId)
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
  return rows[0] ?? null
}

// Moved to @blackcode/platform-db on 2026-08-06 with /api/me, now a shared
// route factory (docs/sales-app-plan.md Phase 1b). One login serves every app,
// so an account read cannot belong to one of them.
export function getUserById(id: number): Promise<User | null> {
  return platformGetUserById(db, id)
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

// Soft-deletes the user: marks deleted_at, clears auth, revokes tokens.
// Returns the workspaces that *would* be hard-deleted (sole-owner with no
// other members) and the workspaces that block deletion (owner with members).
// If `confirm` is false, this is a dry run.
// Account closure and profile edits moved to @blackcode/platform-db on
// 2026-08-06 with /api/me. Both touch only platform.* (users, api_tokens,
// inbox_messages, workspaces, workspace_members), and `softDeleteUser` keeps its
// single-transaction guarantee there.
export type { DeleteAccountReport, UpdateUserProfileInput }

export function deleteAccountReport(userId: number): Promise<DeleteAccountReport> {
  return platformDeleteAccountReport(db, userId)
}

export function softDeleteUser(userId: number): Promise<void> {
  return platformSoftDeleteUser(db, userId)
}

export function updateUserProfile(
  id: number,
  patch: UpdateUserProfileInput
): Promise<User | null> {
  return platformUpdateUserProfile(db, id, patch)
}
