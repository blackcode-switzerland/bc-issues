// Reading a user's workspaces, and remembering which one they were last in.
//
// Both were `apps/issues/lib/db/queries/workspaces.ts` until 2026-08-06 and moved
// when `GET /api/workspaces` and `POST /api/me/active-workspace` became shared
// factories (docs/sales-app-plan.md Phase 1b, D-2). The app file re-exports them
// bound to its own `db`, so every existing call site is unchanged.
//
// WHAT DID NOT MOVE, and must not be moved here casually: `createWorkspace`,
// `updateWorkspace`, `transferOwnership`, `removeMember`. Every one of them
// writes an event through `recordEvent`, which fans out through rules written in
// terms of issues, tasks and project watchers. Extracting the read half is safe;
// the write half needs the event spine untangled first, which is a separate,
// owned piece of work.

import { and, eq } from 'drizzle-orm'
import { accessibleWorkspaceIds, isAppAccessEnforced } from './app-access'
import type { PlatformDb } from './client'
import { users, workspaceMembers, workspaces, type Workspace } from './schema'

export type WorkspaceWithMembership = Workspace & {
  member_role: 'owner' | 'member'
}

/**
 * The workspaces this user belongs to.
 *
 * Pass `{ app }` to get the ones they may actually USE that app in — visibility
 * follows access (docs/platform-architecture.md §4.5). That is what every
 * user-facing listing wants: logged into an app, you should not see a workspace
 * where that app is off or where you were never granted it.
 *
 * Pass nothing for the raw membership list. Two callers genuinely need that and
 * filtering them would be a bug, not a feature:
 *   - `ensureDefaultWorkspace` — "do they belong to anything at all?" A filtered
 *     empty answer there would mint a SECOND workspace for someone who already
 *     has one they simply can't reach.
 *   - `--all` listings, which exist precisely to show what the filter hides.
 *
 * The filter is a no-op when enforcement is off, so the kill switch restores the
 * pre-Phase-4 behaviour here too, not just at the 403.
 */
export async function listMyWorkspaces(
  db: PlatformDb,
  userId: number,
  opts: { app?: string } = {}
): Promise<WorkspaceWithMembership[]> {
  const rows = await db
    .select({
      ws: workspaces,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspace_id))
    .where(eq(workspaceMembers.user_id, userId))
    .orderBy(workspaces.updated_at)

  const all = rows.map((r) => ({ ...r.ws, member_role: r.role as 'owner' | 'member' }))
  if (!opts.app || !isAppAccessEnforced()) return all

  const reachable = await accessibleWorkspaceIds(db, opts.app, userId)
  return all.filter((w) => reachable.has(w.id))
}

/**
 * Resolve a workspace by numeric id or slug, asserting the user is a member.
 *
 * Returns null if the workspace does not exist OR the user is not a member — the
 * route layer decides whether that is a 404 or a 403, and for a workspace you
 * are not in the answer must be 404, so its existence does not leak.
 *
 * NOTE: it does NOT filter `deleted_at IS NULL`. `apps/issues` never did and
 * `apps/_template` did — the two disagreed, and nothing in either app has ever
 * written that column, so they behaved identically. This keeps the production
 * app's semantics rather than settling the question inside a refactor. Whoever
 * gives that column a writer decides it here, once.
 */
export async function getWorkspaceForUser(
  db: PlatformDb,
  slugOrId: string,
  userId: number
): Promise<WorkspaceWithMembership | null> {
  const isNumeric = /^\d+$/.test(slugOrId)
  const rows = await db
    .select({ ws: workspaces, role: workspaceMembers.role })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspace_id, workspaces.id), eq(workspaceMembers.user_id, userId))
    )
    .where(isNumeric ? eq(workspaces.id, parseInt(slugOrId)) : eq(workspaces.slug, slugOrId))
    .limit(1)

  if (!rows[0]) return null
  return { ...rows[0].ws, member_role: rows[0].role as 'owner' | 'member' }
}

/**
 * One workspace by id, with NO membership check.
 *
 * Narrow in who may call it, for the same reason `getWorkspaceBySlug` is: an
 * unchecked lookup that reached a route would let the API confirm which
 * workspaces exist. The caller here is upload attribution, which is resolving a
 * workspace id the user record already carries (`active_workspace_id`) — an id
 * they were given by having been a member, not one they supplied.
 *
 * Moved out of `apps/issues` on 2026-08-06 with `/api/upload`.
 */
export async function getWorkspaceById(db: PlatformDb, id: number): Promise<Workspace | null> {
  const rows = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1)
  return rows[0] ?? null
}

/** Remember which workspace this user was last in. Null clears it. */
export async function setActiveWorkspace(
  db: PlatformDb,
  userId: number,
  workspaceId: number | null
): Promise<void> {
  await db
    .update(users)
    .set({ active_workspace_id: workspaceId, updated_at: new Date() })
    .where(eq(users.id, userId))
}
