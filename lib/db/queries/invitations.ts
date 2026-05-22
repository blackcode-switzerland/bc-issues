// Workspace invitation queries.
//
// Flow:
//   1. Owner POSTs an invite for an email. Any prior pending invite for the
//      same (workspace_id, lower(email)) is revoked first. A fresh token is
//      generated.
//   2. The owner shares the token URL out-of-band (Phase 5 will route it via
//      inbox). Anyone with the token can call /api/invitations/accept while
//      authenticated as a matching email — we verify email match server-side.
//   3. On accept: invitation marked accepted, accepted_by + accepted_at set,
//      workspace_members row inserted (idempotent).
//
// Tokens are 32 raw bytes encoded as base64url (43 chars). They are random,
// not derived; we store the literal string. Tokens are unique by index.

import { randomBytes } from 'crypto'
import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { db } from '../client'
import {
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
  type WorkspaceInvitation,
} from '../schema'
import { recordEvent } from './events'
import { addMember } from './workspaces'

const TOKEN_BYTES = 32
const DEFAULT_TTL_DAYS = 14

export function generateInvitationToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

export interface CreateInvitationInput {
  workspaceId: number
  email: string
  invitedBy: number
  role?: 'member'
  ttlDays?: number
}

export interface CreateInvitationResult {
  invitation: WorkspaceInvitation
  // Set to true if the invitee already had an account at the time of invite.
  // The caller can use this to decide whether to surface an inbox message
  // (when inbox lands in Phase 5) vs only a copy-link UI.
  invitee_has_account: boolean
}

export async function createInvitation(
  input: CreateInvitationInput
): Promise<CreateInvitationResult> {
  const email = input.email.trim().toLowerCase()
  if (!email || !email.includes('@')) {
    throw new Error('invalid_email')
  }

  const ttlDays = input.ttlDays ?? DEFAULT_TTL_DAYS
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)

  return await db.transaction(async (tx) => {
    // Block: invitee is already a member.
    const existing = await tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.user_id))
      .where(
        and(
          eq(workspaceMembers.workspace_id, input.workspaceId),
          sql`lower(${users.email}) = ${email}`
        )
      )
      .limit(1)
    if (existing[0]) throw new Error('already_member')

    // Revoke any prior pending invitations for the same email.
    const revoked = await tx
      .update(workspaceInvitations)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(workspaceInvitations.workspace_id, input.workspaceId),
          sql`lower(${workspaceInvitations.email}) = ${email}`,
          eq(workspaceInvitations.status, 'pending')
        )
      )
      .returning({ id: workspaceInvitations.id })

    for (const r of revoked) {
      await recordEvent(tx, {
        workspaceId: input.workspaceId,
        actorUserId: input.invitedBy,
        entityType: 'invitation',
        entityId: r.id,
        action: 'invitation_revoked',
        meta: { reason: 'superseded' },
      })
    }

    const token = generateInvitationToken()
    const [row] = await tx
      .insert(workspaceInvitations)
      .values({
        workspace_id: input.workspaceId,
        email,
        invited_by: input.invitedBy,
        role: input.role ?? 'member',
        token,
        status: 'pending',
        expires_at: expiresAt,
      })
      .returning()
    if (!row) throw new Error('insert failed')

    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.invitedBy,
      entityType: 'invitation',
      entityId: row.id,
      action: 'invitation_created',
      meta: { email },
    })

    const account = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.email}) = ${email}`, sql`${users.deleted_at} IS NULL`))
      .limit(1)

    return { invitation: row, invitee_has_account: !!account[0] }
  })
}

export interface InvitationListItem extends WorkspaceInvitation {
  invited_by_email: string | null
  invited_by_name: string | null
  workspace_name: string
  workspace_slug: string
}

export async function listWorkspaceInvitations(
  workspaceId: number,
  options: { includeNonPending?: boolean } = {}
): Promise<InvitationListItem[]> {
  const rows = await db
    .select({
      inv: workspaceInvitations,
      invited_by_email: users.email,
      invited_by_name: users.name,
      workspace_name: workspaces.name,
      workspace_slug: workspaces.slug,
    })
    .from(workspaceInvitations)
    .leftJoin(users, eq(users.id, workspaceInvitations.invited_by))
    .leftJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspace_id))
    .where(
      options.includeNonPending
        ? eq(workspaceInvitations.workspace_id, workspaceId)
        : and(
            eq(workspaceInvitations.workspace_id, workspaceId),
            eq(workspaceInvitations.status, 'pending')
          )
    )
    .orderBy(desc(workspaceInvitations.created_at))

  return rows.map((r) => ({
    ...r.inv,
    invited_by_email: r.invited_by_email,
    invited_by_name: r.invited_by_name,
    workspace_name: r.workspace_name ?? '(deleted)',
    workspace_slug: r.workspace_slug ?? '',
  }))
}

export async function revokeInvitation(
  id: number,
  workspaceId: number,
  actorUserId: number
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const result = await tx
      .update(workspaceInvitations)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(workspaceInvitations.id, id),
          eq(workspaceInvitations.workspace_id, workspaceId),
          eq(workspaceInvitations.status, 'pending')
        )
      )
      .returning({ id: workspaceInvitations.id })

    if (result.length === 0) return false

    await recordEvent(tx, {
      workspaceId,
      actorUserId,
      entityType: 'invitation',
      entityId: id,
      action: 'invitation_revoked',
      meta: { reason: 'owner_action' },
    })
    return true
  })
}

export async function getInvitationByToken(
  token: string
): Promise<(WorkspaceInvitation & { workspace_name: string; workspace_slug: string }) | null> {
  const rows = await db
    .select({
      inv: workspaceInvitations,
      workspace_name: workspaces.name,
      workspace_slug: workspaces.slug,
    })
    .from(workspaceInvitations)
    .leftJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspace_id))
    .where(eq(workspaceInvitations.token, token))
    .limit(1)
  if (!rows[0]) return null
  return {
    ...rows[0].inv,
    workspace_name: rows[0].workspace_name ?? '(deleted)',
    workspace_slug: rows[0].workspace_slug ?? '',
  }
}

export async function listPendingInvitationsForEmail(
  email: string
): Promise<InvitationListItem[]> {
  const normalized = email.trim().toLowerCase()
  const rows = await db
    .select({
      inv: workspaceInvitations,
      invited_by_email: users.email,
      invited_by_name: users.name,
      workspace_name: workspaces.name,
      workspace_slug: workspaces.slug,
    })
    .from(workspaceInvitations)
    .leftJoin(users, eq(users.id, workspaceInvitations.invited_by))
    .leftJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspace_id))
    .where(
      and(
        sql`lower(${workspaceInvitations.email}) = ${normalized}`,
        eq(workspaceInvitations.status, 'pending'),
        gt(workspaceInvitations.expires_at, new Date())
      )
    )
    .orderBy(desc(workspaceInvitations.created_at))

  return rows.map((r) => ({
    ...r.inv,
    invited_by_email: r.invited_by_email,
    invited_by_name: r.invited_by_name,
    workspace_name: r.workspace_name ?? '(deleted)',
    workspace_slug: r.workspace_slug ?? '',
  }))
}

export type AcceptResult =
  | { ok: true; workspace_id: number; already_member: boolean }
  | { ok: false; reason: 'not_found' | 'expired' | 'revoked' | 'accepted' | 'declined' | 'email_mismatch' }

export async function acceptInvitation(
  token: string,
  acceptingUserId: number,
  acceptingUserEmail: string
): Promise<AcceptResult> {
  return await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.token, token))
      .limit(1)
    const inv = rows[0]
    if (!inv) return { ok: false, reason: 'not_found' }

    if (inv.email.trim().toLowerCase() !== acceptingUserEmail.trim().toLowerCase()) {
      return { ok: false, reason: 'email_mismatch' }
    }
    if (inv.status === 'revoked') return { ok: false, reason: 'revoked' }
    if (inv.status === 'accepted') return { ok: false, reason: 'accepted' }
    if (inv.status === 'declined') return { ok: false, reason: 'declined' }
    if (inv.expires_at.getTime() < Date.now()) {
      await tx
        .update(workspaceInvitations)
        .set({ status: 'expired' })
        .where(eq(workspaceInvitations.id, inv.id))
      return { ok: false, reason: 'expired' }
    }

    // Idempotent membership insert.
    let alreadyMember = false
    const existing = await tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspace_id, inv.workspace_id),
          eq(workspaceMembers.user_id, acceptingUserId)
        )
      )
      .limit(1)
    if (existing[0]) {
      alreadyMember = true
    } else {
      await tx.insert(workspaceMembers).values({
        workspace_id: inv.workspace_id,
        user_id: acceptingUserId,
        role: 'member',
      })
      await recordEvent(tx, {
        workspaceId: inv.workspace_id,
        actorUserId: acceptingUserId,
        entityType: 'workspace_member',
        entityId: acceptingUserId,
        action: 'member_added',
        meta: { user_id: acceptingUserId, role: 'member', via: 'invitation', invitation_id: inv.id },
      })
    }

    await tx
      .update(workspaceInvitations)
      .set({
        status: 'accepted',
        accepted_at: new Date(),
        accepted_by: acceptingUserId,
      })
      .where(eq(workspaceInvitations.id, inv.id))

    await recordEvent(tx, {
      workspaceId: inv.workspace_id,
      actorUserId: acceptingUserId,
      entityType: 'invitation',
      entityId: inv.id,
      action: 'invitation_accepted',
    })

    return { ok: true, workspace_id: inv.workspace_id, already_member: alreadyMember }
  })
}

export async function declineInvitation(
  token: string,
  acceptingUserId: number,
  acceptingUserEmail: string
): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'email_mismatch' | 'already_resolved' }> {
  return await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.token, token))
      .limit(1)
    const inv = rows[0]
    if (!inv) return { ok: false, reason: 'not_found' }
    if (inv.email.trim().toLowerCase() !== acceptingUserEmail.trim().toLowerCase()) {
      return { ok: false, reason: 'email_mismatch' }
    }
    if (inv.status !== 'pending') return { ok: false, reason: 'already_resolved' }

    await tx
      .update(workspaceInvitations)
      .set({ status: 'declined' })
      .where(eq(workspaceInvitations.id, inv.id))

    await recordEvent(tx, {
      workspaceId: inv.workspace_id,
      actorUserId: acceptingUserId,
      entityType: 'invitation',
      entityId: inv.id,
      action: 'invitation_declined',
    })

    return { ok: true }
  })
}

// Called from the signup paths (credentials register + Google OAuth first
// signin). For every pending invitation matching the user's email, materialize
// an inbox row so the user sees the invitation immediately. Idempotent: only
// invitations that don't yet have an inbox row for the user get one.
export async function materializePendingInvitationsForUser(
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
        workspace_key: workspaces.key,
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
        SELECT id FROM inbox_messages
        WHERE user_id = ${userId}
          AND entity_type = 'invitation'
          AND entity_id = ${inv.id}
        LIMIT 1
      `)
      if (existing.rows[0]) continue

      await tx.execute(sql`
        INSERT INTO inbox_messages
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
             workspace_key: inv.workspace_key ?? '',
             invitation_id: inv.id,
             materialized_on_signup: true,
           })}::jsonb)
      `)
      created++
    }
    return created
  })
}

// Suppress unused-import warning if addMember is not used in this file
// (kept exported via workspaces.ts for the accept path's idempotent insert).
export { addMember }
