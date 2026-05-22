// Issue queries — workspace-scoped, with sequence allocation, automatic
// watcher management, and granular event recording.
//
// Field-level events: a PATCH that changes multiple fields produces one
// 'updated' diff event PLUS dedicated events for each high-signal change:
//   - assignee_id   → 'assigned' / 'unassigned'
//   - status        → 'status_changed' (and sets completed_at / cancelled_at)
//   - priority      → 'priority_changed'
//   - milestone_id  → 'milestone_changed'
//   - project_id    → 'project_changed'
// This lets the activity feed and inbox surface meaningful events without
// dredging through diff jsonb.

import { and, eq, sql } from 'drizzle-orm'
import { db } from '../client'
import { issues, type Issue } from '../schema'
import { recordEvent } from './events'
import { allocateNextIssueSeq } from './workspaces'
import { addWatcher, removeAutoWatcher } from './watchers'

const TERMINAL_STATUSES = new Set(['done', 'cancelled'])
const VALID_STATUSES = new Set([
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'in_review',
  'done',
  'cancelled',
])

export interface IssueListRow extends Issue {
  assignee_name?: string | null
  assignee_email?: string | null
  assignee_avatar?: string | null
  milestone_name?: string | null
  project_name?: string | null
  comment_count?: number
  attachment_count?: number
}

const issueListSelect = sql`
  i.*,
  u.name AS assignee_name,
  u.email AS assignee_email,
  u.avatar_url AS assignee_avatar,
  m.name AS milestone_name,
  p.name AS project_name,
  (SELECT COUNT(*)::int FROM comments c WHERE c.issue_id = i.id) AS comment_count,
  (SELECT COUNT(*)::int FROM attachments a WHERE a.issue_id = i.id) AS attachment_count
`

export interface ListIssuesOptions {
  projectId?: number | null
  milestoneId?: number | null
  assigneeId?: number | null
  status?: string
  priority?: number
  search?: string
  cursor?: number | null
  limit?: number
}

export interface IssuesPage {
  data: IssueListRow[]
  next_cursor: number | null
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function listIssuesInWorkspace(
  workspaceId: number,
  opts: ListIssuesOptions = {}
): Promise<IssuesPage> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

  const projectFilter =
    opts.projectId === null
      ? sql`AND i.project_id IS NULL`
      : opts.projectId !== undefined
        ? sql`AND i.project_id = ${opts.projectId}`
        : sql``
  const milestoneFilter =
    opts.milestoneId === null
      ? sql`AND i.milestone_id IS NULL`
      : opts.milestoneId !== undefined
        ? sql`AND i.milestone_id = ${opts.milestoneId}`
        : sql``
  const assigneeFilter =
    opts.assigneeId === null
      ? sql`AND i.assignee_id IS NULL`
      : opts.assigneeId !== undefined
        ? sql`AND i.assignee_id = ${opts.assigneeId}`
        : sql``

  const result = await db.execute(sql`
    SELECT ${issueListSelect}
    FROM issues i
    LEFT JOIN users u ON u.id = i.assignee_id
    LEFT JOIN milestones m ON m.id = i.milestone_id
    LEFT JOIN projects p ON p.id = i.project_id
    WHERE i.workspace_id = ${workspaceId}
      ${projectFilter}
      ${milestoneFilter}
      ${assigneeFilter}
      ${opts.status ? sql`AND i.status = ${opts.status}` : sql``}
      ${opts.priority ? sql`AND i.priority = ${opts.priority}` : sql``}
      ${
        opts.search
          ? sql`AND (i.title ILIKE ${'%' + opts.search + '%'} OR i.description ILIKE ${'%' + opts.search + '%'})`
          : sql``
      }
      ${opts.cursor ? sql`AND i.id < ${opts.cursor}` : sql``}
    ORDER BY i.id DESC
    LIMIT ${limit + 1}
  `)

  const rows = result.rows as unknown as IssueListRow[]
  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const next_cursor = hasMore ? data[data.length - 1].id : null
  return { data, next_cursor }
}

export async function getIssueInWorkspace(
  workspaceId: number,
  id: number
): Promise<IssueListRow | null> {
  const result = await db.execute(sql`
    SELECT ${issueListSelect}
    FROM issues i
    LEFT JOIN users u ON u.id = i.assignee_id
    LEFT JOIN milestones m ON m.id = i.milestone_id
    LEFT JOIN projects p ON p.id = i.project_id
    WHERE i.id = ${id} AND i.workspace_id = ${workspaceId}
  `)
  return (result.rows[0] as unknown as IssueListRow | undefined) ?? null
}

// Legacy by-id lookup — used by /api/issues/[id] shim. Just bare row; workspace
// gating happens at the route layer.
export async function getIssue(id: number): Promise<Issue | null> {
  const rows = await db.select().from(issues).where(eq(issues.id, id)).limit(1)
  return rows[0] ?? null
}

export interface CreateIssueInput {
  workspaceId: number
  title: string
  description?: string | null
  status?: string
  priority?: number
  assigneeId?: number | null
  milestoneId?: number | null
  projectId?: number | null
  startDate?: string | null
  dueDate?: string | null
  estimatedHours?: number | null
  reporterId: number
  actorUserId: number
}

export async function createIssue(input: CreateIssueInput): Promise<Issue> {
  if (input.status && !VALID_STATUSES.has(input.status)) {
    throw new Error('invalid_status')
  }
  if (input.priority !== undefined && (input.priority < 1 || input.priority > 5)) {
    throw new Error('invalid_priority')
  }

  return await db.transaction(async (tx) => {
    const seq = await allocateNextIssueSeq(tx, input.workspaceId)

    const status = input.status ?? 'backlog'
    const now = new Date()
    const completed_at = status === 'done' ? now : null
    const cancelled_at = status === 'cancelled' ? now : null

    const [row] = await tx
      .insert(issues)
      .values({
        workspace_id: input.workspaceId,
        seq,
        title: input.title,
        description: input.description ?? null,
        status,
        priority: input.priority ?? 3,
        assignee_id: input.assigneeId ?? null,
        milestone_id: input.milestoneId ?? null,
        project_id: input.projectId ?? null,
        reporter_id: input.reporterId,
        start_date: input.startDate ?? null,
        due_date: input.dueDate ?? null,
        estimated_hours: input.estimatedHours != null ? String(input.estimatedHours) : null,
        completed_at,
        cancelled_at,
      })
      .returning()
    if (!row) throw new Error('issue insert returned nothing')

    // Auto-watchers: reporter, and assignee if present.
    await addWatcher(tx, row.id, input.reporterId, 'reporter')
    if (input.assigneeId && input.assigneeId !== input.reporterId) {
      await addWatcher(tx, row.id, input.assigneeId, 'assigned')
    }

    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      entityType: 'issue',
      entityId: row.id,
      action: 'created',
      diff: {
        after: {
          title: row.title,
          status: row.status,
          priority: row.priority,
          project_id: row.project_id,
          milestone_id: row.milestone_id,
          assignee_id: row.assignee_id,
        },
      },
      meta: { seq: row.seq },
    })

    if (input.assigneeId && input.assigneeId !== input.actorUserId) {
      await recordEvent(tx, {
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        entityType: 'issue',
        entityId: row.id,
        action: 'assigned',
        meta: { assignee_id: input.assigneeId, seq: row.seq, title: row.title },
      })
    }

    return row
  })
}

export interface UpdateIssueInput {
  title?: string
  description?: string | null
  status?: string
  priority?: number
  assignee_id?: number | null
  milestone_id?: number | null
  project_id?: number | null
  start_date?: string | null
  due_date?: string | null
  estimated_hours?: number | null
}

export async function updateIssue(
  workspaceId: number,
  id: number,
  patch: UpdateIssueInput,
  actorUserId: number
): Promise<Issue | null> {
  if (patch.status && !VALID_STATUSES.has(patch.status)) {
    throw new Error('invalid_status')
  }
  if (patch.priority !== undefined && (patch.priority < 1 || patch.priority > 5)) {
    throw new Error('invalid_priority')
  }

  return await db.transaction(async (tx) => {
    const beforeRows = await tx
      .select()
      .from(issues)
      .where(and(eq(issues.id, id), eq(issues.workspace_id, workspaceId)))
      .limit(1)
    const before = beforeRows[0]
    if (!before) return null

    const updates: Record<string, unknown> = {}
    if (patch.title !== undefined) updates.title = patch.title
    if (patch.description !== undefined) updates.description = patch.description
    if (patch.priority !== undefined) updates.priority = patch.priority
    if (patch.assignee_id !== undefined) updates.assignee_id = patch.assignee_id
    if (patch.milestone_id !== undefined) updates.milestone_id = patch.milestone_id
    if (patch.project_id !== undefined) updates.project_id = patch.project_id
    if (patch.start_date !== undefined) updates.start_date = patch.start_date
    if (patch.due_date !== undefined) updates.due_date = patch.due_date
    if (patch.estimated_hours !== undefined)
      updates.estimated_hours = patch.estimated_hours != null ? String(patch.estimated_hours) : null
    if (patch.status !== undefined) {
      updates.status = patch.status
      // Reflect terminal transitions in completed_at / cancelled_at.
      const now = new Date()
      if (patch.status === 'done' && before.status !== 'done') {
        updates.completed_at = now
        updates.cancelled_at = null
      } else if (patch.status === 'cancelled' && before.status !== 'cancelled') {
        updates.cancelled_at = now
        updates.completed_at = null
      } else if (TERMINAL_STATUSES.has(before.status ?? '') && !TERMINAL_STATUSES.has(patch.status)) {
        updates.completed_at = null
        updates.cancelled_at = null
      }
    }

    if (Object.keys(updates).length === 0) return before
    updates.updated_at = new Date()

    const [after] = await tx
      .update(issues)
      .set(updates)
      .where(and(eq(issues.id, id), eq(issues.workspace_id, workspaceId)))
      .returning()
    if (!after) return null

    // Field-level events.
    if (patch.assignee_id !== undefined && before.assignee_id !== after.assignee_id) {
      // Update watcher list to reflect new assignment.
      if (before.assignee_id) {
        await removeAutoWatcher(tx, id, before.assignee_id, 'assigned')
      }
      if (after.assignee_id) {
        await addWatcher(tx, id, after.assignee_id, 'assigned')
      }

      if (after.assignee_id) {
        await recordEvent(tx, {
          workspaceId,
          actorUserId,
          entityType: 'issue',
          entityId: id,
          action: 'assigned',
          meta: {
            assignee_id: after.assignee_id,
            previous_assignee_id: before.assignee_id,
            seq: after.seq,
            title: after.title,
          },
        })
      } else {
        await recordEvent(tx, {
          workspaceId,
          actorUserId,
          entityType: 'issue',
          entityId: id,
          action: 'unassigned',
          meta: {
            previous_assignee_id: before.assignee_id,
            seq: after.seq,
            title: after.title,
          },
        })
      }
    }

    if (patch.status !== undefined && before.status !== after.status) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'issue',
        entityId: id,
        action: 'status_changed',
        meta: {
          from: before.status,
          to: after.status,
          seq: after.seq,
          title: after.title,
        },
      })
    }
    if (patch.priority !== undefined && before.priority !== after.priority) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'issue',
        entityId: id,
        action: 'priority_changed',
        meta: {
          from: before.priority,
          to: after.priority,
          seq: after.seq,
          title: after.title,
        },
      })
    }
    if (patch.milestone_id !== undefined && before.milestone_id !== after.milestone_id) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'issue',
        entityId: id,
        action: 'milestone_changed',
        meta: {
          from: before.milestone_id,
          to: after.milestone_id,
          seq: after.seq,
          title: after.title,
        },
      })
    }
    if (patch.project_id !== undefined && before.project_id !== after.project_id) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'issue',
        entityId: id,
        action: 'project_changed',
        meta: {
          from: before.project_id,
          to: after.project_id,
          seq: after.seq,
          title: after.title,
        },
      })
    }

    // Generic updated event for everything else (title / description / dates).
    const generic: Record<string, [unknown, unknown]> = {}
    if (patch.title !== undefined && before.title !== after.title) generic.title = [before.title, after.title]
    if (patch.description !== undefined && before.description !== after.description) generic.description = [before.description, after.description]
    if (patch.start_date !== undefined && String(before.start_date) !== String(after.start_date)) generic.start_date = [before.start_date, after.start_date]
    if (patch.due_date !== undefined && String(before.due_date) !== String(after.due_date)) generic.due_date = [before.due_date, after.due_date]
    if (Object.keys(generic).length > 0) {
      const beforeSnap: Record<string, unknown> = {}
      const afterSnap: Record<string, unknown> = {}
      for (const [k, [b, a]] of Object.entries(generic)) {
        beforeSnap[k] = b
        afterSnap[k] = a
      }
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'issue',
        entityId: id,
        action: 'updated',
        diff: { before: beforeSnap, after: afterSnap },
        meta: { seq: after.seq, title: after.title },
      })
    }

    return after
  })
}

export async function deleteIssue(
  workspaceId: number,
  id: number,
  actorUserId: number
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const beforeRows = await tx
      .select()
      .from(issues)
      .where(and(eq(issues.id, id), eq(issues.workspace_id, workspaceId)))
      .limit(1)
    if (!beforeRows[0]) return false

    await recordEvent(tx, {
      workspaceId,
      actorUserId,
      entityType: 'issue',
      entityId: id,
      action: 'deleted',
      meta: { seq: beforeRows[0].seq, title: beforeRows[0].title },
    })

    const result = await tx
      .delete(issues)
      .where(and(eq(issues.id, id), eq(issues.workspace_id, workspaceId)))
    return (result.rowCount ?? 0) > 0
  })
}

// --- Legacy compatibility ---

export async function getIssuesByProject(projectId: number) {
  const result = await db.execute(sql`
    SELECT ${issueListSelect}
    FROM issues i
    LEFT JOIN users u ON u.id = i.assignee_id
    LEFT JOIN milestones m ON m.id = i.milestone_id
    LEFT JOIN projects p ON p.id = i.project_id
    WHERE i.project_id = ${projectId}
    ORDER BY i.priority ASC, i.updated_at DESC
  `)
  return result.rows
}

export async function getAllIssuesWithProjects() {
  const result = await db.execute(sql`
    SELECT ${issueListSelect}
    FROM issues i
    LEFT JOIN users u ON u.id = i.assignee_id
    LEFT JOIN milestones m ON m.id = i.milestone_id
    LEFT JOIN projects p ON p.id = i.project_id
    ORDER BY i.priority ASC, i.updated_at DESC
  `)
  return result.rows
}

export interface IssuePageLegacy {
  data: unknown[]
  next_cursor: number | null
}

export async function getIssuesPage(opts: {
  project_id?: number
  limit: number
  cursor?: number | null
}): Promise<IssuePageLegacy> {
  const { project_id, limit, cursor } = opts
  const filterProject = project_id !== undefined
  const filterCursor = cursor !== undefined && cursor !== null

  const result = await db.execute(sql`
    SELECT ${issueListSelect}
    FROM issues i
    LEFT JOIN users u ON u.id = i.assignee_id
    LEFT JOIN milestones m ON m.id = i.milestone_id
    LEFT JOIN projects p ON p.id = i.project_id
    WHERE 1=1
      ${filterProject ? sql`AND i.project_id = ${project_id}` : sql``}
      ${filterCursor ? sql`AND i.id < ${cursor}` : sql``}
    ORDER BY i.id DESC
    LIMIT ${limit + 1}
  `)
  const rows = result.rows as Array<{ id: number }>
  const has_more = rows.length > limit
  const data = has_more ? rows.slice(0, limit) : rows
  const next_cursor = has_more ? data[data.length - 1].id : null
  return { data, next_cursor }
}

export async function getIssuesByMilestone(milestoneId: number) {
  const result = await db.execute(sql`
    SELECT ${issueListSelect}
    FROM issues i
    LEFT JOIN users u ON u.id = i.assignee_id
    LEFT JOIN milestones m ON m.id = i.milestone_id
    LEFT JOIN projects p ON p.id = i.project_id
    WHERE i.milestone_id = ${milestoneId}
    ORDER BY i.priority ASC, i.updated_at DESC
  `)
  return result.rows
}

export async function getKanbanView(projectId: number) {
  const rows = await getIssuesByProject(projectId)
  const kanban: Record<string, unknown[]> = {
    backlog: [],
    todo: [],
    in_progress: [],
    blocked: [],
    in_review: [],
    done: [],
  }
  for (const r of rows as Array<{ status: string }>) {
    if (kanban[r.status]) kanban[r.status].push(r)
    else kanban.backlog.push(r)
  }
  return kanban
}
