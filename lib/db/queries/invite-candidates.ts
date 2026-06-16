import { db } from '@/lib/db/client'
import { users, workspaceMembers, workspaces, workspaceInvitations } from '@/lib/db/schema'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'

// A person the current owner can pull into the active workspace without typing
// their email by hand. Sourced from the workspaces the owner already shares
// with them, and — for super admins — from the whole platform.
export interface InviteCandidate {
  user_id: number
  email: string
  name: string | null
  avatar_url: string | null
  // Already a member of the active workspace → render "Already in", no action.
  already_member: boolean
  // A pending invitation already exists for this email in the active workspace.
  invited: boolean
  // Names of the OTHER workspaces (shared with the caller) this person is in.
  // Empty for platform-only candidates the caller doesn't share a workspace with.
  shared_workspaces: string[]
  // True when surfaced only because the caller is a super admin (no shared
  // workspace with them). Lets the UI group "platform" people separately.
  from_platform: boolean
}

interface ListInviteCandidatesInput {
  userId: number
  currentWorkspaceId: number
  // Super admins get every platform user; regular owners only get people they
  // already share a workspace with.
  includePlatform: boolean
}

export async function listInviteCandidates({
  userId,
  currentWorkspaceId,
  includePlatform,
}: ListInviteCandidatesInput): Promise<InviteCandidate[]> {
  // 1. Who is already in the active workspace (so we can flag "Already in").
  const currentRows = await db
    .select({ user_id: workspaceMembers.user_id })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspace_id, currentWorkspaceId))
  const currentMemberIds = new Set(currentRows.map((r) => r.user_id))

  // 2. Emails with a pending invitation in the active workspace (flag "Invited").
  const pendingRows = await db
    .select({ email: workspaceInvitations.email })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspace_id, currentWorkspaceId),
        eq(workspaceInvitations.status, 'pending')
      )
    )
  const pendingEmails = new Set(pendingRows.map((r) => r.email.toLowerCase()))

  // 3. The caller's other workspaces, and everyone in them.
  const myWorkspaceRows = await db
    .select({ workspace_id: workspaceMembers.workspace_id })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.user_id, userId))
  const myWorkspaceIds = myWorkspaceRows.map((r) => r.workspace_id)

  const byUser = new Map<number, InviteCandidate>()

  if (myWorkspaceIds.length > 0) {
    const sharedRows = await db
      .select({
        user_id: users.id,
        email: users.email,
        name: users.name,
        avatar_url: users.avatar_url,
        workspace_id: workspaceMembers.workspace_id,
        workspace_name: workspaces.name,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.user_id))
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspace_id))
      .where(
        and(
          inArray(workspaceMembers.workspace_id, myWorkspaceIds),
          ne(workspaceMembers.user_id, userId),
          isNull(users.deleted_at)
        )
      )

    for (const r of sharedRows) {
      let entry = byUser.get(r.user_id)
      if (!entry) {
        entry = {
          user_id: r.user_id,
          email: r.email,
          name: r.name,
          avatar_url: r.avatar_url,
          already_member: currentMemberIds.has(r.user_id),
          invited: pendingEmails.has(r.email.toLowerCase()),
          shared_workspaces: [],
          from_platform: false,
        }
        byUser.set(r.user_id, entry)
      }
      // Don't list the active workspace itself among "shared" context.
      if (r.workspace_id !== currentWorkspaceId && !entry.shared_workspaces.includes(r.workspace_name)) {
        entry.shared_workspaces.push(r.workspace_name)
      }
    }
  }

  // 4. Super admins additionally see every other platform user.
  if (includePlatform) {
    const platformRows = await db
      .select({
        user_id: users.id,
        email: users.email,
        name: users.name,
        avatar_url: users.avatar_url,
      })
      .from(users)
      .where(and(isNull(users.deleted_at), ne(users.id, userId)))

    for (const r of platformRows) {
      if (byUser.has(r.user_id)) continue
      byUser.set(r.user_id, {
        user_id: r.user_id,
        email: r.email,
        name: r.name,
        avatar_url: r.avatar_url,
        already_member: currentMemberIds.has(r.user_id),
        invited: pendingEmails.has(r.email.toLowerCase()),
        shared_workspaces: [],
        from_platform: true,
      })
    }
  }

  return [...byUser.values()].sort((a, b) => {
    // Joinable people first, then already-in; alpha within each group.
    if (a.already_member !== b.already_member) return a.already_member ? 1 : -1
    return (a.name ?? a.email).localeCompare(b.name ?? b.email)
  })
}
