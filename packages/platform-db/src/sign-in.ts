// What signing in does to `platform.users` — the queries behind next-auth's
// callbacks.
//
// ---------------------------------------------------------------------------
// WHY THESE ARE SHARED AND `authOptions` IS NOT
// ---------------------------------------------------------------------------
// There is ONE login for every app (docs/platform-architecture.md §6): one
// `platform.users` row, one password, one Google identity. So "find this person
// by email", "record that they just logged in" and "turn the invitations
// addressed to them into inbox rows" are the same four statements in every app,
// and an app writing its own copy is an app that can get the fourth one wrong
// and silently swallow somebody's invitations.
//
// `authOptions` itself deliberately did NOT move, and the long version of why is
// in `packages/platform-auth/src/index.ts`. Short version: an app's providers,
// its cookie and its redirect pages are genuinely its own. What is shared is
// what those callbacks DO to the database, which is this file.
//
// Moved from `apps/issues/lib/db/queries/{users,invitations}.ts` on 2026-08-06
// (docs/sales-app-plan.md Phase 1b-C). Each app re-exports these bound to its
// own `db`, so no call site changed.
//
// NOT here, on purpose: `createWorkspace` and `ensureDefaultWorkspace`, the two
// remaining sign-in callbacks. Each app has an app-specific post-create step —
// issues inserts `issues.workspace_counters` — and an app-specific statement
// inside a shared function is how the boundary rots (D-23).

import { and, eq, gt, sql } from 'drizzle-orm'
import type { PlatformDb } from './client'
import { inboxMessages, users, workspaceInvitations, workspaces, type User } from './schema'

export async function getUserByEmail(db: PlatformDb, email: string): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
  return rows[0] ?? null
}

export async function touchLastLogin(db: PlatformDb, id: number): Promise<void> {
  await db.update(users).set({ last_login: new Date() }).where(eq(users.id, id))
}

export interface UpsertUserFromOAuthInput {
  google_id?: string
  email: string
  name?: string | null
  avatar_url?: string | null
}

/**
 * Create or refresh the user behind an OAuth sign-in.
 *
 * `was_new` is read BEFORE the upsert, because it is what tells the caller to
 * run the first-login side effects — the default workspace and the pending
 * invitations. `onConflictDoUpdate` cannot report which branch it took.
 */
export async function upsertUserFromOAuth(
  db: PlatformDb,
  data: UpsertUserFromOAuthInput
): Promise<{ user: User; was_new: boolean }> {
  const existing = await getUserByEmail(db, data.email)
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

  const final = await getUserByEmail(db, data.email)
  if (!final) throw new Error('upsert returned no user')
  return { user: final, was_new }
}

/**
 * Turn every pending invitation addressed to this email into an inbox row.
 *
 * Called from the signup paths — credentials register and a first Google
 * sign-in. Idempotent: an invitation that already has an inbox row for this user
 * is skipped, which is what makes it safe beside the fan-out path that handles
 * the case where the account already existed.
 *
 * Records no event, by design. The invitations were already announced when they
 * were created; this is a projection catching up with an account that did not
 * exist yet, not something new happening.
 *
 * @returns how many inbox rows were created.
 */
export async function materializePendingInvitationsForUser(
  db: PlatformDb,
  userId: number,
  email: string
): Promise<number> {
  const normalized = email.trim().toLowerCase()
  return await db.transaction(async (tx) => {
    const invitations = await tx
      .select({
        id: workspaceInvitations.id,
        workspace_id: workspaceInvitations.workspace_id,
        invited_by: workspaceInvitations.invited_by,
        workspace_name: workspaces.name,
      })
      .from(workspaceInvitations)
      .leftJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspace_id))
      .where(
        and(
          sql`lower(${workspaceInvitations.email}) = ${normalized}`,
          eq(workspaceInvitations.status, 'pending'),
          gt(workspaceInvitations.expires_at, new Date())
        )
      )

    let created = 0
    for (const inv of invitations) {
      // Skip if we've already materialized this invitation for this user
      // (the fan-out path already handled it when the user existed).
      const existing = await tx.execute<{ id: number }>(sql`
        SELECT id FROM ${inboxMessages}
        WHERE user_id = ${userId}
          AND entity_type = 'invitation'
          AND entity_id = ${inv.id}
        LIMIT 1
      `)
      if (existing.rows[0]) continue

      await tx.execute(sql`
        INSERT INTO ${inboxMessages}
          (user_id, workspace_id, type, entity_type, entity_id, actor_user_id, payload)
        VALUES
          (${userId},
           ${inv.workspace_id},
           'invitation',
           'invitation',
           ${inv.id},
           ${inv.invited_by},
           ${JSON.stringify({
             workspace_id: inv.workspace_id,
             workspace_name: inv.workspace_name ?? '',
             invitation_id: inv.id,
             materialized_on_signup: true,
           })}::jsonb)
      `)
      created++
    }
    return created
  })
}
