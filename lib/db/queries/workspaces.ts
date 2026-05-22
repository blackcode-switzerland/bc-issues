// Workspace CRUD + member queries.
//
// Membership rules (enforced here, mirrored in §1.2 of architecture-rebuild.md):
//   - createWorkspace inserts the workspace + owner membership + counter atomically.
//   - getWorkspaceForUser returns the row only if the user is an active member.
//   - transferOwnership moves the 'owner' role to another existing member.
//   - deleteWorkspace cascades (FKs handle it) — caller verifies role first.

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
import { recordEvent } from './events'

export type WorkspaceWithMembership = Workspace & {
  member_role: 'owner' | 'member'
}

export async function listMyWorkspaces(userId: number): Promise<WorkspaceWithMembership[]> {
  const rows = await db
    .select({
      ws: workspaces,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspace_id))
    .where(eq(workspaceMembers.user_id, userId))
    .orderBy(workspaces.updated_at)

  return rows.map((r) => ({ ...r.ws, member_role: r.role as 'owner' | 'member' }))
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

// Allocate the next issue sequence atomically. Must run inside a transaction
// alongside the issue insert so that an aborted insert rolls back the seq.
export async function allocateNextIssueSeq(
  tx: typeof db,
  workspaceId: number
): Promise<number> {
  const rows = await tx.execute<{ last_issue_seq: number }>(sql`
    UPDATE workspace_counters
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

export interface CreateWorkspaceInput {
  name: string
  ownerId: number
  slug?: string
  key?: string
  logo_url?: string
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  const slug = await pickAvailableSlug(input.slug ?? slugify(input.name))
  const key = await pickAvailableKey(input.key ?? keyify(input.name))

  return await db.transaction(async (tx) => {
    const [ws] = await tx
      .insert(workspaces)
      .values({
        name: input.name,
        slug,
        key,
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

    await recordEvent(tx, {
      workspaceId: ws.id,
      actorUserId: input.ownerId,
      entityType: 'workspace',
      entityId: ws.id,
      action: 'created',
      diff: { after: { name: ws.name, slug: ws.slug, key: ws.key } },
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

export interface UpdateWorkspaceInput {
  name?: string
  slug?: string
  key?: string
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
  if (patch.key !== undefined) updates.key = await pickAvailableKey(keyify(patch.key), id)

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
  return { name: w.name, slug: w.slug, key: w.key, logo_url: w.logo_url }
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

export async function addMember(
  workspaceId: number,
  userId: number,
  role: 'owner' | 'member' = 'member',
  actorUserId?: number
): Promise<void> {
  await db.transaction(async (tx) => {
    const result = await tx
      .insert(workspaceMembers)
      .values({ workspace_id: workspaceId, user_id: userId, role })
      .onConflictDoNothing()
      .returning({ id: workspaceMembers.id })
    if (result.length > 0) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId: actorUserId ?? null,
        entityType: 'workspace_member',
        entityId: userId,
        action: 'member_added',
        meta: { user_id: userId, role },
      })
    }
  })
}

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
const KEY_MAX = 6

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SLUG_MAX)
  return base || 'workspace'
}

export function keyify(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return (cleaned.slice(0, KEY_MAX) || 'WS').slice(0, KEY_MAX)
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

async function pickAvailableKey(desired: string, excludeId?: number): Promise<string> {
  const base = keyify(desired)
  return await pickAvailable(base, async (candidate) => {
    const rows = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.key, candidate))
      .limit(1)
    if (!rows[0]) return true
    return excludeId !== undefined && rows[0].id === excludeId
  }, KEY_MAX)
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

// Bulk lookup of memberships used by /api/me/workspaces and similar.
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
