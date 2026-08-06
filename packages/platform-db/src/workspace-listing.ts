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

import { eq } from 'drizzle-orm'
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
