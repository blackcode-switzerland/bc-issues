// Milestone queries — workspace-scoped. project_id is optional: milestones
// can exist standalone within a workspace.
//
// Listing rules:
//   - listMilestonesInWorkspace(ws, { project_id: null })   only standalone
//   - listMilestonesInWorkspace(ws, { project_id: <N> })   only attached to project N
//   - listMilestonesInWorkspace(ws, {})                     everything in the workspace

import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../client'
import { milestones, type Milestone } from '../schema'
import { recordEvent } from './events'
import { softDeleteMilestone, type DeleteMode } from './deletion'

export interface MilestoneListItem extends Milestone {
  project_name: string | null
  project_icon: string | null
  project_color: string | null
  issue_count: number
  completed_issues: number
}

export interface ListMilestonesOptions {
  projectId?: number | null
  status?: string
  search?: string
}

export async function listMilestonesInWorkspace(
  workspaceId: number,
  opts: ListMilestonesOptions = {}
): Promise<MilestoneListItem[]> {
  const result = await db.execute(sql`
    SELECT
      m.*,
      p.name AS project_name,
      p.icon AS project_icon,
      p.color AS project_color,
      COUNT(i.id)::int AS issue_count,
      COUNT(i.id) FILTER (WHERE i.status = 'done')::int AS completed_issues
    FROM milestones m
    LEFT JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL
    LEFT JOIN issues i ON i.milestone_id = m.id AND i.deleted_at IS NULL
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
    GROUP BY m.id, p.name, p.icon, p.color
    ORDER BY m.due_date ASC NULLS LAST, m.id DESC
  `)
  return result.rows as unknown as MilestoneListItem[]
}

export async function getMilestoneInWorkspace(
  workspaceId: number,
  id: number
): Promise<MilestoneListItem | null> {
  const result = await db.execute(sql`
    SELECT
      m.*,
      p.name AS project_name,
      p.icon AS project_icon,
      p.color AS project_color,
      COUNT(i.id)::int AS issue_count,
      COUNT(i.id) FILTER (WHERE i.status = 'done')::int AS completed_issues
    FROM milestones m
    LEFT JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL
    LEFT JOIN issues i ON i.milestone_id = m.id AND i.deleted_at IS NULL
    WHERE m.id = ${id} AND m.workspace_id = ${workspaceId} AND m.deleted_at IS NULL
    GROUP BY m.id, p.name, p.icon, p.color
  `)
  return (result.rows[0] as unknown as MilestoneListItem) ?? null
}

// Legacy by-id lookup — used by the old /api/milestones/[id] endpoint while
// the dashboard UI still calls it. Workspace gating happens at the route layer.
export async function getMilestone(id: number): Promise<Milestone | null> {
  const rows = await db
    .select()
    .from(milestones)
    .where(and(eq(milestones.id, id), isNull(milestones.deleted_at)))
    .limit(1)
  return rows[0] ?? null
}

export interface CreateMilestoneInput {
  workspaceId: number
  name: string
  description?: string | null
  due_date?: string | null
  status?: string
  projectId?: number | null
  actorUserId: number
}

export async function createMilestone(input: CreateMilestoneInput): Promise<Milestone> {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(milestones)
      .values({
        workspace_id: input.workspaceId,
        project_id: input.projectId ?? null,
        name: input.name,
        description: input.description ?? null,
        due_date: input.due_date ?? null,
        status: input.status ?? 'active',
      })
      .returning()
    if (!row) throw new Error('milestone insert returned nothing')

    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      entityType: 'milestone',
      entityId: row.id,
      action: 'created',
      diff: {
        after: { name: row.name, project_id: row.project_id, due_date: row.due_date },
      },
    })
    return row
  })
}

export interface UpdateMilestoneInput {
  name?: string
  description?: string | null
  due_date?: string | null
  status?: string
  project_id?: number | null
}

const MILESTONE_DIFF_KEYS = ['name', 'description', 'due_date', 'status', 'project_id'] as const

export async function updateMilestone(
  workspaceId: number,
  id: number,
  patch: UpdateMilestoneInput,
  actorUserId: number
): Promise<Milestone | null> {
  return await db.transaction(async (tx) => {
    const beforeRows = await tx
      .select()
      .from(milestones)
      .where(and(eq(milestones.id, id), eq(milestones.workspace_id, workspaceId)))
      .limit(1)
    const before = beforeRows[0]
    if (!before) return null

    const updates: Record<string, unknown> = {}
    if (patch.name !== undefined) updates.name = patch.name
    if (patch.description !== undefined) updates.description = patch.description
    if (patch.due_date !== undefined) updates.due_date = patch.due_date
    if (patch.status !== undefined) updates.status = patch.status
    if (patch.project_id !== undefined) updates.project_id = patch.project_id

    if (Object.keys(updates).length === 0) return before
    updates.updated_at = new Date()

    const [after] = await tx
      .update(milestones)
      .set(updates)
      .where(and(eq(milestones.id, id), eq(milestones.workspace_id, workspaceId)))
      .returning()
    if (!after) return null

    if (patch.status !== undefined && before.status !== after.status) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'milestone',
        entityId: id,
        action: 'status_changed',
        meta: { from: before.status, to: after.status, title: after.name },
      })
    }
    if (patch.due_date !== undefined && String(before.due_date) !== String(after.due_date)) {
      await recordEvent(tx, {
        workspaceId,
        actorUserId,
        entityType: 'milestone',
        entityId: id,
        action: 'due_date_changed',
        meta: {
          from: before.due_date ? String(before.due_date).slice(0, 10) : null,
          to: after.due_date ? String(after.due_date).slice(0, 10) : null,
          title: after.name,
        },
      })
    }

    const beforeSnap: Record<string, unknown> = {}
    const afterSnap: Record<string, unknown> = {}
    for (const k of MILESTONE_DIFF_KEYS) {
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
        entityType: 'milestone',
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
export async function deleteMilestone(
  workspaceId: number,
  id: number,
  actorUserId: number,
  mode: DeleteMode = 'detach'
): Promise<boolean> {
  return softDeleteMilestone(workspaceId, id, actorUserId, mode)
}

// --- Legacy compatibility ---

export async function getMilestones(projectId: number) {
  const result = await db.execute(sql`
    SELECT m.*,
      COUNT(i.id)::int AS issue_count,
      COUNT(i.id) FILTER (WHERE i.status = 'done')::int AS completed_issues
    FROM milestones m
    LEFT JOIN issues i ON i.milestone_id = m.id AND i.deleted_at IS NULL
    WHERE m.project_id = ${projectId} AND m.deleted_at IS NULL
    GROUP BY m.id
    ORDER BY m.due_date ASC NULLS LAST
  `)
  return result.rows
}

export async function getAllMilestones() {
  const result = await db.execute(sql`
    SELECT m.*, p.name AS project_name,
      COUNT(i.id)::int AS issue_count,
      COUNT(i.id) FILTER (WHERE i.status = 'done')::int AS completed_issues
    FROM milestones m
    LEFT JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL
    LEFT JOIN issues i ON i.milestone_id = m.id AND i.deleted_at IS NULL
    WHERE m.deleted_at IS NULL
    GROUP BY m.id, p.name
    ORDER BY m.due_date ASC NULLS LAST
  `)
  return result.rows
}

export async function getMilestoneWithDetails(id: number) {
  const result = await db.execute(sql`
    SELECT m.*, p.name AS project_name,
      COUNT(i.id)::int AS issue_count,
      COUNT(i.id) FILTER (WHERE i.status = 'done')::int AS completed_issues
    FROM milestones m
    LEFT JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL
    LEFT JOIN issues i ON i.milestone_id = m.id AND i.deleted_at IS NULL
    WHERE m.id = ${id} AND m.deleted_at IS NULL
    GROUP BY m.id, p.name
  `)
  return result.rows[0] ?? null
}
