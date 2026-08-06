// The PLATFORM half of the event fan-out: an event about a workspace, a
// membership or an invitation becoming inbox rows for the people it concerns.
//
// Runs in the SAME transaction as the source event. It must be cheap and never
// block on external systems.
//
// ---------------------------------------------------------------------------
// WHERE THE SEAM IS, AND HOW TO TELL IF YOU ARE ABOUT TO CROSS IT
// ---------------------------------------------------------------------------
// These five handlers moved out of `apps/issues/lib/db/queries/fanout.ts` on
// 2026-08-06 (docs/sales-app-plan.md D-23). They are exactly the handlers above
// that file's `--- issue fan-out handlers ---` line, and the split was not a
// judgement call: every table they touch — `users`, `workspaces`,
// `workspace_invitations` — is a `platform.*` table, and every table the
// handlers below that line touch (`issues`, `issue_watchers`, `tasks`,
// `projects`) belongs to one app.
//
// **That is enforced by this package's imports, not by a comment.** There is
// nothing to import here for an app table: `./schema` is the platform schema and
// `platform-db` may not depend on an app. A sixth handler dragged in from the
// issues half fails to compile on its first `issues`/`issueWatchers` reference.
// If you ever find one that does compile, the handler is reading an app's data
// through raw SQL and that is the thing to stop.
//
// The corresponding rule for the app half: an app keeps `fanOutEvent` for its
// own entity types only. `recordPlatformEvent` calls `fanOutPlatformEvent`
// itself, so an app must NOT also route these five actions through its own
// switch — that would post every invitation twice.

import { and, eq, sql } from 'drizzle-orm'
import type { PlatformTx } from './client'
import { users, workspaceInvitations, workspaces, type Event } from './schema'
import { createInboxMessage } from './inbox-write'

/**
 * Fan out one platform event.
 *
 * The `default` case is load-bearing rather than lazy: the `app_*` actions
 * (Phase 4) are activity-feed only by design — enabling an app for a workspace
 * is not something to put in five people's inboxes.
 */
export async function fanOutPlatformEvent(tx: PlatformTx, event: Event): Promise<void> {
  switch (event.action) {
    case 'invitation_created':
      return fanOutInvitationCreated(tx, event)
    case 'member_added':
      return fanOutMemberAdded(tx, event)
    case 'member_removed':
      return fanOutMemberRemoved(tx, event)
    case 'ownership_transferred':
      return fanOutOwnershipTransferred(tx, event)
    case 'invitation_accepted':
      return fanOutInvitationAccepted(tx, event)
    default:
      return
  }
}

// --- handlers ---

async function fanOutInvitationCreated(tx: PlatformTx, event: Event): Promise<void> {
  const email = (event.meta as { email?: string } | null)?.email
  if (!email) return

  const user = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        sql`lower(${users.email}) = ${email.toLowerCase()}`,
        sql`${users.deleted_at} IS NULL`
      )
    )
    .limit(1)
  if (!user[0]) return // pre-signup invitation, materialized on signup

  const ws = await tx
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, event.workspace_id))
    .limit(1)

  // The accept page lives at /invitations/[token]; carry the token in the
  // payload so the inbox detail pane can link to it directly.
  const invite = await tx
    .select({ token: workspaceInvitations.token })
    .from(workspaceInvitations)
    .where(eq(workspaceInvitations.id, event.entity_id))
    .limit(1)

  await createInboxMessage(tx, {
    userId: user[0].id,
    eventId: event.id,
    workspaceId: event.workspace_id,
    type: 'invitation',
    entityType: 'invitation',
    entityId: event.entity_id,
    actorUserId: event.actor_user_id,
    payload: {
      workspace_id: event.workspace_id,
      workspace_name: ws[0]?.name ?? '',
      invitation_id: event.entity_id,
      invitation_token: invite[0]?.token ?? null,
    },
  })
}

async function fanOutMemberAdded(tx: PlatformTx, event: Event): Promise<void> {
  // Notify the workspace owner that a new member joined (unless they ARE the
  // new member — e.g. via accepting their own pending invite isn't a thing
  // we model, but skip to be safe).
  const ws = await tx
    .select({ owner_id: workspaces.owner_id, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, event.workspace_id))
    .limit(1)
  if (!ws[0]) return
  const ownerId = ws[0].owner_id
  if (ownerId === event.entity_id) return

  await createInboxMessage(tx, {
    userId: ownerId,
    eventId: event.id,
    workspaceId: event.workspace_id,
    type: 'member_added',
    entityType: 'workspace_member',
    entityId: event.entity_id,
    actorUserId: event.actor_user_id,
    payload: {
      workspace_id: event.workspace_id,
      workspace_name: ws[0].name,
      new_member_user_id: event.entity_id,
    },
  })
}

async function fanOutMemberRemoved(tx: PlatformTx, event: Event): Promise<void> {
  // Notify the user who was removed, unless they removed themselves.
  if (event.actor_user_id === event.entity_id) return
  const ws = await tx
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, event.workspace_id))
    .limit(1)
  await createInboxMessage(tx, {
    userId: event.entity_id,
    eventId: event.id,
    workspaceId: null, // they're no longer a member; show as cross-workspace system msg
    type: 'member_removed',
    entityType: 'workspace_member',
    entityId: event.entity_id,
    actorUserId: event.actor_user_id,
    payload: {
      workspace_id: event.workspace_id,
      workspace_name: ws[0]?.name ?? '',
    },
  })
}

async function fanOutOwnershipTransferred(tx: PlatformTx, event: Event): Promise<void> {
  const meta = event.meta as
    | { previous_owner_user_id?: number; new_owner_user_id?: number }
    | null
  if (!meta?.previous_owner_user_id || !meta?.new_owner_user_id) return

  const ws = await tx
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, event.workspace_id))
    .limit(1)
  const workspaceName = ws[0]?.name ?? ''

  for (const uid of [meta.previous_owner_user_id, meta.new_owner_user_id]) {
    await createInboxMessage(tx, {
      userId: uid,
      eventId: event.id,
      workspaceId: event.workspace_id,
      type: 'ownership_transferred',
      entityType: 'workspace',
      entityId: event.workspace_id,
      actorUserId: event.actor_user_id,
      payload: {
        workspace_id: event.workspace_id,
        workspace_name: workspaceName,
        previous_owner_user_id: meta.previous_owner_user_id,
        new_owner_user_id: meta.new_owner_user_id,
        you_are: uid === meta.new_owner_user_id ? 'new_owner' : 'previous_owner',
      },
    })
  }
}

async function fanOutInvitationAccepted(tx: PlatformTx, event: Event): Promise<void> {
  // Notify the original inviter. We need to look up the invitation row to find
  // invited_by. Since the event entity_id is the invitation id, query it.
  const rows = await tx.execute<{ invited_by: number; email: string }>(sql`
    SELECT invited_by, email FROM ${workspaceInvitations} WHERE id = ${event.entity_id}
  `)
  const row = rows.rows[0]
  if (!row) return
  if (row.invited_by === event.actor_user_id) return // self-accept edge case

  const ws = await tx
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, event.workspace_id))
    .limit(1)
  await createInboxMessage(tx, {
    userId: row.invited_by,
    eventId: event.id,
    workspaceId: event.workspace_id,
    type: 'invitation_accepted',
    entityType: 'invitation',
    entityId: event.entity_id,
    actorUserId: event.actor_user_id,
    payload: {
      workspace_id: event.workspace_id,
      workspace_name: ws[0]?.name ?? '',
      invitee_email: row.email,
      invitee_user_id: event.actor_user_id,
    },
  })
}
