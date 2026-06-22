// Task queries — workspace-scoped. project_id is optional: tasks
// can exist standalone within a workspace.
//
// Listing rules:
//   - listTasksInWorkspace(ws, { project_id: null })   only standalone
//   - listTasksInWorkspace(ws, { project_id: <N> })   only attached to project N
//   - listTasksInWorkspace(ws, {})                     everything in the workspace

import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../client'
import { tasks, type Task } from '../schema'
import { recordEvent } from './events'
import { softDeleteTask, type DeleteMode } from './deletion'
import { allocateNextTaskSeq } from './workspaces'
import { toRichTextHtml } from '@/lib/rich-text'

export interface TaskListItem extends Task {
  project_name: string | null
  project_icon: string | null
  project_color: string | null
  lead_name: string | null
  lead_email: string | null
  lead_avatar: string | null
  issue_count: number
  completed_issues: number
}

export interface ListTasksOptions {
  projectId?: number | null
  status?: string
  search?: string
}

export async function listTasksInWorkspace(
  workspaceId: number,
  opts: ListTasksOptions = {}
): Promise<TaskListItem[]> {
  const result = await db.execute(sql`
    SELECT
      m.*,
      p.name AS project_name,
      p.icon AS project_icon,
      p.color AS project_color,
      lead.name AS lead_name,
      lead.email AS lead_email,
      lead.avatar_url AS lead_avatar,
      COUNT(i.id)::int AS issue_count,
      COUNT(i.id) FILTER (WHERE i.status = 'done')::int AS completed_issues
    FROM tasks m
    LEFT JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL
    LEFT JOIN users lead ON lead.id = m.lead_id
    LEFT JOIN issues i ON i.task_id = m.id AND i.deleted_at IS NULL
    WHERE m.workspace_id = ${workspaceId}
      AND m.deleted_at IS NULL
      ${
        opts.projectId === null
          ? sql`AND m.project_id IS NULL`
          : opts.projectId !== undefined
            ? sql`AND m.project_id = ${opts.projectId}`
            : sql``
      }
      ${opts.status ? sql`AND m.status = ${opts.status}` : sql``}
      ${
        opts.search
          ? sql`AND (m.name ILIKE ${'%' + opts.search + '%'} OR m.description ILIKE ${'%' + opts.search + '%'})`
          : sql``
      }
    GROUP BY m.id, p.name, p.icon, p.color, lead.name, lead.email, lead.avatar_url
    ORDER BY m.due_date ASC NULLS LAST, m.id DESC
  `)
  return result.rows as unknown as TaskListItem[]
}

export async function getTaskInWorkspace(
  workspaceId: number,
  id: number
): Promise<TaskListItem | null> {
  const result = await db.execute(sql`
    SELECT
      m.*,
      p.name AS project_name,
      p.icon AS project_icon,
      p.color AS project_color,
      lead.name AS lead_name,
      lead.email AS lead_email,
      lead.avatar_url AS lead_avatar,
      COUNT(i.id)::int AS issue_count,
      COUNT(i.id) FILTER (WHERE i.status = 'done')::int AS completed_issues
    FROM tasks m
    LEFT JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL
    LEFT JOIN users lead ON lead.id = m.lead_id
    LEFT JOIN issues i ON i.task_id = m.id AND i.deleted_at IS NULL
    WHERE m.id = ${id} AND m.workspace_id = ${workspaceId} AND m.deleted_at IS NULL
    GROUP BY m.id, p.name, p.icon, p.color, lead.name, lead.email, lead.avatar_url
  `)
  return (result.rows[0] as unknown as TaskListItem) ?? null
}

export interface CreateTaskInput {
  workspaceId: number
  name: string
  description?: string | null
  due_date?: string | null
  status?: string
  projectId?: number | null
  lead_user_id?: number | null
  actorUserId: number
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  return await db.transaction(async (tx) => {
    const seq = await allocateNextTaskSeq(tx, input.workspaceId)
    const [row] = await tx
      .insert(tasks)
      .values({
        workspace_id: input.workspaceId,
        seq,
        project_id: input.projectId ?? null,
        name: input.name,
        description: toRichTextHtml(input.description) ?? null,
        due_date: input.due_date ?? null,
        status: input.status ?? 'active',
        // Mirror projects: default the lead to the creator.
        lead_id: input.lead_user_id ?? input.actorUserId,
      })
      .returning()
    if (!row) throw new Error('task insert returned nothing')

    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      entityType: 'task',
      entityId: row.id,
      action: 'created',
      diff: {
        after: { name: row.name, project_id: row.project_id, due_date: row.due_date },
      },
    })
    return row
  })
}

export interface UpdateTaskInput {
  name?: string
  description?: string | null
  due_date?: string | null
  status?: string
  project_id?: number | null
  lead_user_id?: number | null
}

const TASK_DIFF_KEYS = ['name', 'description', 'due_date', 'status', 'project_id'] as const

export async function updateTask(
  workspaceId: number,
  id: number,
  patch: UpdateTaskInput,
  actorUserId: number
): Promise<Task | null> {
  return await db.transaction(async (tx) => {
    const beforeRows = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.workspace_id, workspaceId)))
      .limit(1)
    const before = beforeRows[0]
    if (!before) return null

    const updates: Record<string, unknown> = {}
    if (patch.name !== undefined) updates.name = patch.name
    if (patch.description !== undefined) updates.description = toRichTextHtml(patch.description)
    if (patch.due_date !== undefined) updates.due_date = patch.due_date
    if (patch.status !== undefined) updates.status = patch.status
    if (patch.project_id !== undefined) updates.project_id = patch.project_id
    if (patch.lead_user_id !== undefined) updates.lead_id = patch.lead_user_id

    if (Object.keys(updates).length === 0) return before
    updates.updated_at = new Date()

    const [after] = await tx
      .update(tasks)
      .set(updates)
      .where(and(eq(tasks.id, id), eq(tasks.workspace_id, workspaceId)))
      .returning()
    if (!after) return null

    if (patch.status !== undefined && before.status !== after.status) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'task',
        entityId: id,
        action: 'status_changed',
        meta: { from: before.status, to: after.status, title: after.name },
      })
    }
    if (patch.due_date !== undefined && String(before.due_date) !== String(after.due_date)) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'task',
        entityId: id,
        action: 'due_date_changed',
        meta: {
          from: before.due_date ? String(before.due_date).slice(0, 10) : null,
          to: after.due_date ? String(after.due_date).slice(0, 10) : null,
          title: after.name,
        },
      })
    }
    if (patch.lead_user_id !== undefined && before.lead_id !== after.lead_id) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'task',
        entityId: id,
        action: after.lead_id ? 'assigned' : 'unassigned',
        meta: {
          assignee_id: after.lead_id,
          previous_assignee_id: before.lead_id,
          title: after.name,
        },
      })
    }

    const beforeSnap: Record<string, unknown> = {}
    const afterSnap: Record<string, unknown> = {}
    for (const k of TASK_DIFF_KEYS) {
      if ((before as Record<string, unknown>)[k] !== (after as Record<string, unknown>)[k]) {
        beforeSnap[k] = (before as Record<string, unknown>)[k]
        afterSnap[k] = (after as Record<string, unknown>)[k]
      }
    }
    const remainingKeys = Object.keys(beforeSnap).filter(
      (k) => !['status', 'due_date'].includes(k)
    )
    if (remainingKeys.length > 0) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'task',
        entityId: id,
        action: 'updated',
        diff: { before: beforeSnap, after: afterSnap },
      })
    }
    return after
  })
}

// Delete now means soft-delete (move to the recycle bin). `mode` controls the
// attached issues: 'detach' (default) keeps them active but unlinks them;
// 'cascade' bins them together. See lib/db/queries/deletion.ts.
export async function deleteTask(
  workspaceId: number,
  id: number,
  actorUserId: number,
  mode: DeleteMode = 'detach'
): Promise<boolean> {
  return softDeleteTask(workspaceId, id, actorUserId, mode)
}

// --- Legacy compatibility ---

export async function getTasks(projectId: number) {
  const result = await db.execute(sql`
    SELECT m.*,
      COUNT(i.id)::int AS issue_count,
      COUNT(i.id) FILTER (WHERE i.status = 'done')::int AS completed_issues
    FROM tasks m
    LEFT JOIN issues i ON i.task_id = m.id AND i.deleted_at IS NULL
    WHERE m.project_id = ${projectId} AND m.deleted_at IS NULL
    GROUP BY m.id
    ORDER BY m.due_date ASC NULLS LAST
  `)
  return result.rows
}

export async function getAllTasks() {
  const result = await db.execute(sql`
    SELECT m.*, p.name AS project_name,
      COUNT(i.id)::int AS issue_count,
      COUNT(i.id) FILTER (WHERE i.status = 'done')::int AS completed_issues
    FROM tasks m
    LEFT JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL
    LEFT JOIN issues i ON i.task_id = m.id AND i.deleted_at IS NULL
    WHERE m.deleted_at IS NULL
    GROUP BY m.id, p.name
    ORDER BY m.due_date ASC NULLS LAST
  `)
  return result.rows
}

export async function getTaskWithDetails(id: number) {
  const result = await db.execute(sql`
    SELECT m.*, p.name AS project_name,
      COUNT(i.id)::int AS issue_count,
      COUNT(i.id) FILTER (WHERE i.status = 'done')::int AS completed_issues
    FROM tasks m
    LEFT JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL
    LEFT JOIN issues i ON i.task_id = m.id AND i.deleted_at IS NULL
    WHERE m.id = ${id} AND m.deleted_at IS NULL
    GROUP BY m.id, p.name
  `)
  return result.rows[0] ?? null
}
