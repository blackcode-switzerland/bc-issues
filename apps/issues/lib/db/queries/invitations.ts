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
//      workspace_members row inserted (idempotent) AND the matching app_access
//      rows granted in the same transaction (Phase 4). An invitation may name an
//      `app` to grant access to one app specifically.
//
// Tokens are 32 raw bytes encoded as base64url (43 chars), never starting with
// `-` — see generateInvitationToken for why. They are random, not derived; we
// store the literal string. Tokens are unique by index.

import { randomBytes } from 'crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../client'
import {
  listPendingInvitationsForEmail as platformListPendingInvitationsForEmail,
  materializePendingInvitationsForUser as platformMaterializePendingInvitationsForUser,
} from '@blackcode/platform-db'
import { type WorkspaceInvitation, users, workspaceInvitations, workspaceMembers, workspaces } from '../schema'
import { grantDefaultAppAccess } from '@blackcode/platform-db'
import { recordEvent } from './events'

const TOKEN_BYTES = 32
const DEFAULT_TTL_DAYS = 14

/**
 * A token is 32 random bytes, base64url-encoded — but never one that begins
 * with `-`.
 *
 * base64url's alphabet includes `-`, so about 1 in 32 tokens used to start with
 * one, and every one of those was unredeemable from the CLI: `bk invite accept
 * -Jx…` made cobra read the token as a flag and fail with `unknown shorthand
 * flag: 'J'` before the request was ever sent. Hit for real during Phase 4
 * verification.
 *
 * The CLI now reads that argument literally, but only in versions from 1.10.0
 * on. Refusing to mint the token here is what protects every binary already
 * installed, which is the population we cannot upgrade.
 *
 * Rejection is on the FIRST character only, and the rest of the string keeps the
 * full alphabet: it costs ~0.05 bits of the token's 256 and leaves the retry
 * loop expected to run 1.03 times.
 */
export function generateInvitationToken(): string {
  for (;;) {
    const token = randomBytes(TOKEN_BYTES).toString('base64url')
    if (!token.startsWith('-')) return token
  }
}

export interface CreateInvitationInput {
  workspaceId: number
  email: string
  invitedBy: number
  role?: 'member'
  ttlDays?: number
  /**
   * Invite this person straight into one app (Phase 4). Omit / null for an
   * org-level invite, where accepting grants whatever the workspace's apps hand
   * out by default. Set, it also grants that app even if the app is
   * 'invite_only' there — the invitation is the grant.
   */
  app?: string | null
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
        app: input.app ?? null,
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

// Moved to @blackcode/platform-db on 2026-08-06 with
// GET /api/me/pending-invitations. It matches on the EMAIL, not a user id — an
// invitation can predate the account it is for, which is the point of inviting
// by address.
export function listPendingInvitationsForEmail(email: string) {
  return platformListPendingInvitationsForEmail(db, email)
}

export type AcceptResult =
  | { ok: true; workspace_id: number; already_member: boolean; apps_granted: string[] }
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
    let grantedApps: string[] = []
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

      // MEMBERSHIP INSERT SITE 2 of 2 (the other is createWorkspace).
      //
      // Same transaction as the insert above. Without this the invitee becomes a
      // member of a workspace that renders empty for them — the quiet failure this
      // phase is built to avoid.
      //
      // `alsoGrantApp: inv.app` is what makes an invitation INTO one app work: the
      // default_access policy is honoured for every other app, but the app the
      // person was invited to is granted even under 'invite_only', because the
      // invitation IS the grant. NULL (an org-level invite) changes nothing.
      grantedApps = await grantDefaultAppAccess(tx, {
        workspaceId: inv.workspace_id,
        userId: acceptingUserId,
        role: 'member',
        grantedBy: inv.invited_by,
        alsoGrantApp: inv.app,
      })

      await recordEvent(tx, {
        workspaceId: inv.workspace_id,
        actorUserId: acceptingUserId,
        entityType: 'workspace_member',
        entityId: acceptingUserId,
        action: 'member_added',
        meta: {
          user_id: acceptingUserId,
          role: 'member',
          via: 'invitation',
          invitation_id: inv.id,
          apps_granted: grantedApps,
        },
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

    return {
      ok: true,
      workspace_id: inv.workspace_id,
      already_member: alreadyMember,
      apps_granted: grantedApps,
    }
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

// Moved to @blackcode/platform-db on 2026-08-06 (docs/sales-app-plan.md Phase
// 1b-C). Called from the signup paths — credentials register, and a first Google
// sign-in — and every app has those, because there is one login for all of them.
// It reads platform.workspace_invitations + platform.workspaces and writes
// platform.inbox_messages, in one transaction, and records no event.
export function materializePendingInvitationsForUser(
  userId: number,
  email: string
): Promise<number> {
  return platformMaterializePendingInvitationsForUser(db, userId, email)
}
