// Workspace CRUD + member queries.
//
// Membership rules (enforced here, mirrored in §1.2 of architecture-rebuild.md):
//   - createWorkspace inserts the workspace + owner membership + counter + the
//     app registry rows atomically.
//   - getWorkspaceForUser returns the row only if the user is an active member.
//     App access is a SEPARATE gate — see lib/api/workspace-context.ts.
//   - transferOwnership moves the 'owner' role to another existing member.
//   - deleteWorkspace cascades (FKs handle it) — caller verifies role first.
//
// Phase 4 added a second axis: a workspace can be visible to you as a member and
// still not be a workspace you may use THIS app in. listMyWorkspaces takes an
// optional `app` for that; see the note on it before changing a call site.

import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../client'
import {
  users,
  workspaces,
  workspaceCounters,
  workspaceMembers,
  type Workspace,
  type WorkspaceMember,
} from '../schema'
import {
  accessibleWorkspaceIds,
  enableAllAppsForWorkspace,
  renameWorkspaceEntities,
  syncAppAccessRole,
} from '@blackcode/platform-db'
import { isAppAccessEnforced } from '@blackcode/platform-api'
import { recordEvent } from './events'

export type WorkspaceWithMembership = Workspace & {
  member_role: 'owner' | 'member'
}

/**
 * The workspaces this user belongs to.
 *
 * Pass `{ app }` to get the ones they may actually USE that app in — visibility
 * follows access (docs/platform-architecture.md §4.5). That is what every user-facing
 * listing wants: logged into issues, you should not see a workspace where issues
 * is off or where you were never granted it.
 *
 * Pass nothing for the raw membership list. Two callers genuinely need that and
 * filtering them would be a bug, not a feature:
 *   - ensureDefaultWorkspace — "do they belong to anything at all?" A filtered
 *     empty answer there would mint a SECOND workspace for someone who already
 *     has one they simply can't reach.
 *   - `--all` listings, which exist precisely to show what the filter hides.
 *
 * The filter is a no-op when enforcement is off, so the kill switch restores the
 * pre-Phase-4 behaviour here too, not just at the 403.
 */
export async function listMyWorkspaces(
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

// Resolve a workspace by numeric id or slug, asserting the user is a member.
// Returns null if the workspace doesn't exist OR the user is not a member —
// the route layer can decide whether to surface 404 vs 403.
export async function getWorkspaceForUser(
  slugOrId: string,
  userId: number
): Promise<WorkspaceWithMembership | null> {
  const isNumeric = /^\d+$/.test(slugOrId)
  const rows = await db
    .select({ ws: workspaces, role: workspaceMembers.role })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspace_id, workspaces.id),
        eq(workspaceMembers.user_id, userId)
      )
    )
    .where(isNumeric ? eq(workspaces.id, parseInt(slugOrId)) : eq(workspaces.slug, slugOrId))
    .limit(1)

  if (!rows[0]) return null
  return { ...rows[0].ws, member_role: rows[0].role as 'owner' | 'member' }
}

export async function getWorkspaceById(id: number): Promise<Workspace | null> {
  const rows = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1)
  return rows[0] ?? null
}

/**
 * Look a workspace up by slug WITHOUT a membership check.
 *
 * Deliberately narrow in who may call it: only the super-admin surface, where
 * the caller is by definition allowed to see every workspace. Every other route
 * must use `getWorkspaceForUser`, which is what makes "not a member" and "does
 * not exist" the same 404 and stops the API confirming which workspaces exist.
 */
export async function getWorkspaceBySlug(slug: string): Promise<Workspace | null> {
  const rows = await db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1)
  return rows[0] ?? null
}

// Allocate the next issue sequence atomically. Must run inside a transaction
// alongside the issue insert so that an aborted insert rolls back the seq.
export async function allocateNextIssueSeq(
  tx: typeof db,
  workspaceId: number
): Promise<number> {
  const rows = await tx.execute<{ last_issue_seq: number }>(sql`
    UPDATE ${workspaceCounters}
    SET last_issue_seq = last_issue_seq + 1
    WHERE workspace_id = ${workspaceId}
    RETURNING last_issue_seq
  `)
  const next = rows.rows[0]?.last_issue_seq
  if (typeof next !== 'number') {
    throw new Error(`workspace_counters row missing for workspace ${workspaceId}`)
  }
  return next
}

// Allocate the next project sequence atomically (workspace-scoped #number).
export async function allocateNextProjectSeq(
  tx: typeof db,
  workspaceId: number
): Promise<number> {
  const rows = await tx.execute<{ last_project_seq: number }>(sql`
    UPDATE ${workspaceCounters}
    SET last_project_seq = last_project_seq + 1
    WHERE workspace_id = ${workspaceId}
    RETURNING last_project_seq
  `)
  const next = rows.rows[0]?.last_project_seq
  if (typeof next !== 'number') {
    throw new Error(`workspace_counters row missing for workspace ${workspaceId}`)
  }
  return next
}

// Allocate the next task sequence atomically (workspace-scoped #number).
export async function allocateNextTaskSeq(
  tx: typeof db,
  workspaceId: number
): Promise<number> {
  const rows = await tx.execute<{ last_task_seq: number }>(sql`
    UPDATE ${workspaceCounters}
    SET last_task_seq = last_task_seq + 1
    WHERE workspace_id = ${workspaceId}
    RETURNING last_task_seq
  `)
  const next = rows.rows[0]?.last_task_seq
  if (typeof next !== 'number') {
    throw new Error(`workspace_counters row missing for workspace ${workspaceId}`)
  }
  return next
}

export interface CreateWorkspaceInput {
  name: string
  ownerId: number
  slug?: string
  logo_url?: string
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  const slug = await pickAvailableSlug(input.slug ?? slugify(input.name))

  return await db.transaction(async (tx) => {
    const [ws] = await tx
      .insert(workspaces)
      .values({
        name: input.name,
        slug,
        logo_url: input.logo_url,
        owner_id: input.ownerId,
      })
      .returning()
    if (!ws) throw new Error('workspace insert returned nothing')

    await tx.insert(workspaceMembers).values({
      workspace_id: ws.id,
      user_id: input.ownerId,
      role: 'owner',
    })

    await tx.insert(workspaceCounters).values({
      workspace_id: ws.id,
      last_issue_seq: 0,
    })

    // MEMBERSHIP INSERT SITE 1 of 2 (the other is acceptInvitation).
    //
    // Same transaction as the workspace_members insert above, and that is not
    // stylistic: a membership row that commits without its app_access row is a
    // person who is a member of a workspace they cannot open. This path serves
    // three entry points — explicit workspace create, POST /api/auth/register,
    // and OAuth first login via lib/auth.ts → ensureDefaultWorkspace — so getting
    // it wrong here locks out every new account, not just one.
    //
    // Every globally-enabled app is turned on, not just this one: a workspace is
    // the company, and the company is the same company in the next app.
    await enableAllAppsForWorkspace(tx, {
      workspaceId: ws.id,
      ownerId: input.ownerId,
      enabledBy: input.ownerId,
    })

    await recordEvent(tx, {
      workspaceId: ws.id,
      actorUserId: input.ownerId,
      entityType: 'workspace',
      entityId: ws.id,
      action: 'created',
      diff: { after: { name: ws.name, slug: ws.slug } },
    })
    await recordEvent(tx, {
      workspaceId: ws.id,
      actorUserId: input.ownerId,
      entityType: 'workspace_member',
      entityId: input.ownerId,
      action: 'member_added',
      meta: { user_id: input.ownerId, role: 'owner', via: 'workspace_create' },
    })

    return ws
  })
}

// Guarantees the "every user has a workspace" invariant. Called on account
// creation (credentials signup + fresh Google sign-in). Idempotent: if the
// user already belongs to a workspace it does nothing except ensure an active
// workspace is selected.
export async function ensureDefaultWorkspace(
  userId: number,
  displayName: string | null | undefined,
  email: string
): Promise<void> {
  const existing = await listMyWorkspaces(userId)
  if (existing.length > 0) {
    // They have a workspace (e.g. joined one via invitation). Make sure one is
    // marked active so the dashboard isn't stuck on an empty selection.
    const rows = await db
      .select({ active: users.active_workspace_id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (!rows[0]?.active) {
      await setActiveWorkspace(userId, existing[0].id)
    }
    return
  }
  const base = displayName?.trim() || email.split('@')[0] || 'My'
  const ws = await createWorkspace({ name: `${base}'s Workspace`, ownerId: userId })
  await setActiveWorkspace(userId, ws.id)
}

export interface UpdateWorkspaceInput {
  name?: string
  slug?: string
  logo_url?: string | null
}

export async function updateWorkspace(
  id: number,
  patch: UpdateWorkspaceInput,
  actorUserId: number
): Promise<Workspace | null> {
  const before = await getWorkspaceById(id)
  if (!before) return null

  const updates: Record<string, unknown> = {}
  if (patch.name !== undefined) updates.name = patch.name
  if (patch.logo_url !== undefined) updates.logo_url = patch.logo_url
  if (patch.slug !== undefined) updates.slug = await pickAvailableSlug(slugify(patch.slug), id)

  if (Object.keys(updates).length === 0) {
    return before
  }

  updates.updated_at = new Date()

  return await db.transaction(async (tx) => {
    const [row] = await tx
      .update(workspaces)
      .set(updates)
      .where(eq(workspaces.id, id))
      .returning()
    if (!row) return null

    // A URN embeds the workspace slug, so renaming the workspace rewrites every
    // URN in it. Links follow automatically — their foreign keys into
    // `platform.entities` are ON UPDATE CASCADE — which is what makes "a link
    // survives a rename" a property of the schema rather than of this call site
    // being remembered. Same transaction as the slug update: a rename that
    // committed without this would leave every URN in the workspace pointing at
    // a slug that no longer exists.
    if (row.slug !== before.slug) {
      await renameWorkspaceEntities(tx, id, before.slug, row.slug)
    }

    await recordEvent(tx, {
      workspaceId: id,
      actorUserId,
      entityType: 'workspace',
      entityId: id,
      action: 'updated',
      diff: {
        before: pickWorkspaceDiff(before),
        after: pickWorkspaceDiff(row),
      },
    })
    return row
  })
}

function pickWorkspaceDiff(w: Workspace) {
  return { name: w.name, slug: w.slug, logo_url: w.logo_url }
}

export async function deleteWorkspace(id: number): Promise<boolean> {
  const result = await db.delete(workspaces).where(eq(workspaces.id, id))
  return (result.rowCount ?? 0) > 0
}

// Transfer ownership: bumps current owner to 'member', promotes the target to
// 'owner', updates workspaces.owner_id. The target must already be a member.
// Throws if not.
export async function transferOwnership(
  workspaceId: number,
  newOwnerUserId: number,
  actorUserId: number
): Promise<void> {
  await db.transaction(async (tx) => {
    const ws = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1)
    if (!ws[0]) throw new Error('workspace_not_found')

    const memberRow = await tx
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspace_id, workspaceId),
          eq(workspaceMembers.user_id, newOwnerUserId)
        )
      )
      .limit(1)
    if (!memberRow[0]) throw new Error('not_a_member')

    if (ws[0].owner_id === newOwnerUserId) return

    const previousOwner = ws[0].owner_id

    await tx
      .update(workspaceMembers)
      .set({ role: 'member' })
      .where(
        and(
          eq(workspaceMembers.workspace_id, workspaceId),
          eq(workspaceMembers.user_id, previousOwner)
        )
      )
    await tx
      .update(workspaceMembers)
      .set({ role: 'owner' })
      .where(
        and(
          eq(workspaceMembers.workspace_id, workspaceId),
          eq(workspaceMembers.user_id, newOwnerUserId)
        )
      )
    await tx
      .update(workspaces)
      .set({ owner_id: newOwnerUserId, updated_at: new Date() })
      .where(eq(workspaces.id, workspaceId))

    // Keep app_access.role in step. Nothing enforces on that column yet, but a
    // row claiming 'owner' for a demoted member is a trap for whoever reads it
    // first — and the backfill deliberately mirrored the roles, so leaving them
    // to drift would make the mirror a lie after one transfer.
    await syncAppAccessRole(tx, workspaceId, previousOwner, 'member')
    await syncAppAccessRole(tx, workspaceId, newOwnerUserId, 'owner')

    await recordEvent(tx, {
      workspaceId,
      actorUserId,
      entityType: 'workspace',
      entityId: workspaceId,
      action: 'ownership_transferred',
      meta: { previous_owner_user_id: previousOwner, new_owner_user_id: newOwnerUserId },
    })
  })
}

export async function listWorkspaceMembers(workspaceId: number) {
  return await db
    .select({
      id: workspaceMembers.id,
      workspace_id: workspaceMembers.workspace_id,
      user_id: workspaceMembers.user_id,
      role: workspaceMembers.role,
      joined_at: workspaceMembers.joined_at,
      email: users.email,
      name: users.name,
      avatar_url: users.avatar_url,
      deleted_at: users.deleted_at,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.user_id))
    .where(eq(workspaceMembers.workspace_id, workspaceId))
    .orderBy(workspaceMembers.joined_at)
}

export async function getMembership(
  workspaceId: number,
  userId: number
): Promise<WorkspaceMember | null> {
  const rows = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspace_id, workspaceId),
        eq(workspaceMembers.user_id, userId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

// Removing a member also removes their app_access — by FK cascade, not by code
// here. app_access's primary FK is to workspace_members (workspace_id, user_id)
// ON DELETE CASCADE, which is why this function needs no Phase 4 change and why a
// future third removal path cannot forget to do it. Verified on the rehearsal
// branch: deleting one membership row took its app_access row with it.
export async function removeMember(
  workspaceId: number,
  userId: number,
  actorUserId: number
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const result = await tx
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspace_id, workspaceId),
          eq(workspaceMembers.user_id, userId)
        )
      )
    const removed = (result.rowCount ?? 0) > 0
    if (removed) {
      const isSelf = actorUserId === userId
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'workspace_member',
        entityId: userId,
        action: isSelf ? 'member_left' : 'member_removed',
        meta: { user_id: userId },
      })
    }
    return removed
  })
}

// NOTE: there is deliberately no `addMember` here. It existed until Phase 4 as a
// third `insert(workspaceMembers)` with no callers — `invitations.ts` imported it
// only to re-export it. Membership now carries an app_access grant written in the
// same transaction (see grantDefaultAppAccess), so a bare membership insert is a
// lockout waiting to be wired up. The two real membership paths are
// createWorkspace (above) and acceptInvitation (invitations.ts); add a third only
// by going through the same helper.

// True if the user is the 'owner' of at least one (non-deleted) workspace.
// Used to gate trust-bar UIs like the public error detail view.
export async function isWorkspaceOwnerSomewhere(userId: number): Promise<boolean> {
  const rows = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.user_id, userId), eq(workspaceMembers.role, 'owner')))
    .limit(1)
  return rows.length > 0
}

export async function setActiveWorkspace(userId: number, workspaceId: number | null): Promise<void> {
  await db
    .update(users)
    .set({ active_workspace_id: workspaceId, updated_at: new Date() })
    .where(eq(users.id, userId))
}

// ----- slug/key generation -----

const SLUG_MAX = 40

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SLUG_MAX)
  return base || 'workspace'
}

async function pickAvailableSlug(desired: string, excludeId?: number): Promise<string> {
  const base = slugify(desired)
  return await pickAvailable(base, async (candidate) => {
    const rows = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, candidate))
      .limit(1)
    if (!rows[0]) return true
    return excludeId !== undefined && rows[0].id === excludeId
  }, SLUG_MAX)
}

async function pickAvailable(
  base: string,
  isAvailable: (candidate: string) => Promise<boolean>,
  maxLen: number
): Promise<string> {
  if (await isAvailable(base)) return base
  for (let n = 2; n < 1000; n++) {
    const suffix = String(n)
    const room = Math.max(1, maxLen - suffix.length)
    const candidate = (base.slice(0, room) + suffix).slice(0, maxLen)
    if (await isAvailable(candidate)) return candidate
  }
  throw new Error(`could not find available identifier from base ${base}`)
}

// Bulk lookup of memberships used across the workspace queries.
export async function userIsMemberOf(userId: number, workspaceIds: number[]): Promise<Set<number>> {
  if (workspaceIds.length === 0) return new Set()
  const rows = await db
    .select({ workspace_id: workspaceMembers.workspace_id })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.user_id, userId),
        inArray(workspaceMembers.workspace_id, workspaceIds)
      )
    )
  return new Set(rows.map((r) => r.workspace_id))
}
