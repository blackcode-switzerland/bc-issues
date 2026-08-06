// Fan-out: given a freshly recorded event about one of THIS APP's entities,
// materialize per-user inbox messages per the rules in §1.5 of
// docs/architecture-rebuild.md.
//
// This runs in the SAME transaction as the source event. It must be cheap and
// never block on external systems. For high-fan-out events (e.g. workspace
// deletion → notify all members), we accept up to ~50 inserts inline.
//
// ---------------------------------------------------------------------------
// THE PLATFORM HALF IS NOT HERE ANY MORE
// ---------------------------------------------------------------------------
// Until 2026-08-06 this file also held five handlers for workspace, membership
// and invitation events. They moved to
// `packages/platform-db/src/fanout-platform.ts` (docs/sales-app-plan.md D-23),
// because none of them referenced a single issues table and every app would
// otherwise have needed its own copy — five copies of "who do we tell when
// somebody is invited", drifting apart one bug fix at a time.
//
// The split ran along the `--- issue fan-out handlers ---` line that was already
// in this file. Everything left below it reaches `issues`, `issue_watchers`,
// `tasks` or `projects`, which is exactly why it stayed.
//
// **Do not re-add a platform case to this switch.** `recordPlatformEvent` fans
// out its own events; a case here as well would post every invitation twice.
// `recordEvent` no longer calls this for platform entity types at all.

import { and, eq, ne, sql } from 'drizzle-orm'
import { db } from '../client'
import {
  issueWatchers,
  issues,
  tasks,
  projects,
  workspaceMembers,
  workspaces,
  type Event,
} from '../schema'
import { createInboxMessage } from './inbox'

type Tx = Pick<typeof db, 'insert' | 'select' | 'update' | 'delete' | 'execute'>

export async function fanOutEvent(tx: Tx, event: Event): Promise<void> {
  switch (event.action) {
    case 'assigned':
      return fanOutAssigned(tx, event)
    case 'unassigned':
      return fanOutUnassigned(tx, event)
    case 'status_changed':
      return fanOutStatusChanged(tx, event)
    case 'commented':
      return fanOutCommented(tx, event)
    case 'mentioned':
      return fanOutMentioned(tx, event)
    default:
      return
  }
}

// --- issue fan-out handlers ---

async function fanOutAssigned(tx: Tx, event: Event): Promise<void> {
  const meta = event.meta as
    | { assignee_id?: number; previous_assignee_id?: number; seq?: number; title?: string }
    | null
  if (!meta?.assignee_id) return
  if (meta.assignee_id === event.actor_user_id) return // self-assign, no notification

  const ws = await tx
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, event.workspace_id))
    .limit(1)

  await createInboxMessage(tx, {
    userId: meta.assignee_id,
    eventId: event.id,
    workspaceId: event.workspace_id,
    type: 'assigned',
    entityType: 'issue',
    entityId: event.entity_id,
    actorUserId: event.actor_user_id,
    payload: {
      workspace_id: event.workspace_id,
      workspace_name: ws[0]?.name ?? '',
      issue_id: event.entity_id,
      issue_seq: meta.seq ?? null,
      issue_title: meta.title ?? '',
      previous_assignee_id: meta.previous_assignee_id ?? null,
    },
  })
}

async function fanOutUnassigned(tx: Tx, event: Event): Promise<void> {
  const meta = event.meta as
    | { previous_assignee_id?: number; seq?: number; title?: string }
    | null
  if (!meta?.previous_assignee_id) return
  if (meta.previous_assignee_id === event.actor_user_id) return

  const ws = await tx
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, event.workspace_id))
    .limit(1)

  await createInboxMessage(tx, {
    userId: meta.previous_assignee_id,
    eventId: event.id,
    workspaceId: event.workspace_id,
    type: 'unassigned',
    entityType: 'issue',
    entityId: event.entity_id,
    actorUserId: event.actor_user_id,
    payload: {
      workspace_id: event.workspace_id,
      workspace_name: ws[0]?.name ?? '',
      issue_id: event.entity_id,
      issue_seq: meta.seq ?? null,
      issue_title: meta.title ?? '',
    },
  })
}

async function fanOutStatusChanged(tx: Tx, event: Event): Promise<void> {
  const meta = event.meta as { from?: string; to?: string; seq?: number; title?: string } | null

  // Recipients: all current watchers + the reporter, minus the actor.
  const watchers = await tx
    .select({ user_id: issueWatchers.user_id })
    .from(issueWatchers)
    .where(eq(issueWatchers.issue_id, event.entity_id))

  const issueRows = await tx
    .select({ reporter_id: issues.reporter_id })
    .from(issues)
    .where(eq(issues.id, event.entity_id))
    .limit(1)

  const recipients = new Set<number>()
  for (const w of watchers) recipients.add(w.user_id)
  if (issueRows[0]?.reporter_id) recipients.add(issueRows[0].reporter_id)
  if (event.actor_user_id) recipients.delete(event.actor_user_id)

  if (recipients.size === 0) return

  const ws = await tx
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, event.workspace_id))
    .limit(1)

  for (const uid of recipients) {
    await createInboxMessage(tx, {
      userId: uid,
      eventId: event.id,
      workspaceId: event.workspace_id,
      type: 'status_changed',
      entityType: 'issue',
      entityId: event.entity_id,
      actorUserId: event.actor_user_id,
      payload: {
        workspace_id: event.workspace_id,
        workspace_name: ws[0]?.name ?? '',
        issue_id: event.entity_id,
        issue_seq: meta?.seq ?? null,
        issue_title: meta?.title ?? '',
        from: meta?.from ?? null,
        to: meta?.to ?? null,
      },
    })
  }
}

async function fanOutCommented(tx: Tx, event: Event): Promise<void> {
  // Only fan out for issue-parented comments for now. Task/project
  // comments are informational only — the activity feed has them.
  if (event.entity_type !== 'issue') return

  const watchers = await tx
    .select({ user_id: issueWatchers.user_id })
    .from(issueWatchers)
    .where(eq(issueWatchers.issue_id, event.entity_id))

  const issueRow = await tx
    .select({
      reporter_id: issues.reporter_id,
      seq: issues.seq,
      title: issues.title,
    })
    .from(issues)
    .where(eq(issues.id, event.entity_id))
    .limit(1)

  const meta = event.meta as
    | { comment_id?: number; excerpt?: string; mentioned_user_ids?: number[] }
    | null

  const recipients = new Set<number>()
  for (const w of watchers) recipients.add(w.user_id)
  if (issueRow[0]?.reporter_id) recipients.add(issueRow[0].reporter_id)
  if (event.actor_user_id) recipients.delete(event.actor_user_id)
  // Mentioned users get a dedicated 'mention' inbox row from fanOutMentioned —
  // skip them here to avoid noise.
  for (const uid of meta?.mentioned_user_ids ?? []) recipients.delete(uid)

  if (recipients.size === 0) return

  const ws = await tx
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, event.workspace_id))
    .limit(1)

  for (const uid of recipients) {
    await createInboxMessage(tx, {
      userId: uid,
      eventId: event.id,
      workspaceId: event.workspace_id,
      type: 'commented',
      entityType: 'issue',
      entityId: event.entity_id,
      actorUserId: event.actor_user_id,
      payload: {
        workspace_id: event.workspace_id,
        workspace_name: ws[0]?.name ?? '',
        issue_id: event.entity_id,
        issue_seq: issueRow[0]?.seq ?? null,
        issue_title: issueRow[0]?.title ?? '',
        comment_id: meta?.comment_id ?? null,
        excerpt: meta?.excerpt ?? '',
      },
    })
  }
}

async function fanOutMentioned(tx: Tx, event: Event): Promise<void> {
  const meta = event.meta as
    | { mentioned_user_id?: number; comment_id?: number; excerpt?: string }
    | null
  if (!meta?.mentioned_user_id) return

  const ws = await tx
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, event.workspace_id))
    .limit(1)

  let issueSeq: number | null = null
  let issueTitle: string | null = null
  if (event.entity_type === 'issue') {
    const issueRow = await tx
      .select({ seq: issues.seq, title: issues.title })
      .from(issues)
      .where(eq(issues.id, event.entity_id))
      .limit(1)
    issueSeq = issueRow[0]?.seq ?? null
    issueTitle = issueRow[0]?.title ?? null
  }

  // entity_seq = the entity's workspace #number, so the inbox preview can open
  // the detail view (which addresses by seq). Covers task/project mentions too.
  let entitySeq: number | null = issueSeq
  if (entitySeq == null && (event.entity_type === 'task' || event.entity_type === 'project')) {
    const tbl = event.entity_type === 'task' ? tasks : projects
    const r = await tx.select({ seq: tbl.seq }).from(tbl).where(eq(tbl.id, event.entity_id)).limit(1)
    entitySeq = r[0]?.seq ?? null
  }

  await createInboxMessage(tx, {
    userId: meta.mentioned_user_id,
    eventId: event.id,
    workspaceId: event.workspace_id,
    type: 'mention',
    entityType: event.entity_type,
    entityId: event.entity_id,
    actorUserId: event.actor_user_id,
    payload: {
      workspace_id: event.workspace_id,
      workspace_name: ws[0]?.name ?? '',
      issue_id: event.entity_type === 'issue' ? event.entity_id : null,
      issue_seq: issueSeq,
      entity_seq: entitySeq,
      issue_title: issueTitle,
      parent_type: event.entity_type,
      parent_id: event.entity_id,
      comment_id: meta.comment_id ?? null,
      excerpt: meta.excerpt ?? '',
    },
  })
}

// keep these imported to avoid TS pruning warnings; reserved for future
// fan-out rules (e.g. workspace_deleted → all members).
void ne
void workspaceMembers
