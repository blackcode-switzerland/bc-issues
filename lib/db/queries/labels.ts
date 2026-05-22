// Label queries — workspace-scoped. Labels are shared across all projects in
// the workspace and can be applied to issues directly. The legacy project_id
// column is no longer required.
//
// Names are case-insensitive unique within a workspace (enforced at the
// application layer; Phase 13 cleanup will add a partial unique index).

import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../client'
import { issueLabels, issues, labels, type Label } from '../schema'
import { recordEvent } from './events'

export interface LabelListItem extends Label {
  issue_count: number
}

export async function listLabelsInWorkspace(workspaceId: number): Promise<LabelListItem[]> {
  const rows = await db.execute(sql`
    SELECT l.*,
      (SELECT COUNT(*)::int FROM issue_labels il
        INNER JOIN issues i ON i.id = il.issue_id
        WHERE il.label_id = l.id AND i.workspace_id = ${workspaceId}) AS issue_count
    FROM labels l
    WHERE l.workspace_id = ${workspaceId}
    ORDER BY l.name ASC
  `)
  return rows.rows as unknown as LabelListItem[]
}

export async function getLabelInWorkspace(
  workspaceId: number,
  id: number
): Promise<Label | null> {
  const rows = await db
    .select()
    .from(labels)
    .where(and(eq(labels.id, id), eq(labels.workspace_id, workspaceId)))
    .limit(1)
  return rows[0] ?? null
}

async function findLabelByName(
  workspaceId: number,
  name: string
): Promise<Label | null> {
  const rows = await db
    .select()
    .from(labels)
    .where(
      and(
        eq(labels.workspace_id, workspaceId),
        sql`lower(${labels.name}) = ${name.toLowerCase()}`
      )
    )
    .limit(1)
  return rows[0] ?? null
}

export interface CreateLabelInput {
  workspaceId: number
  name: string
  color?: string
  description?: string | null
  actorUserId: number
}

export async function createLabel(input: CreateLabelInput): Promise<Label> {
  const name = input.name.trim()
  const existing = await findLabelByName(input.workspaceId, name)
  if (existing) throw new Error('label_exists')

  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(labels)
      .values({
        workspace_id: input.workspaceId,
        name,
        color: input.color ?? '#6b7280',
        description: input.description ?? null,
        created_by: input.actorUserId,
      })
      .returning()
    if (!row) throw new Error('label insert returned nothing')

    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      entityType: 'label',
      entityId: row.id,
      action: 'created',
      diff: { after: { name: row.name, color: row.color } },
    })
    return row
  })
}

export interface UpdateLabelInput {
  name?: string
  color?: string
  description?: string | null
}

export async function updateLabel(
  workspaceId: number,
  id: number,
  patch: UpdateLabelInput,
  actorUserId: number
): Promise<Label | null> {
  return await db.transaction(async (tx) => {
    const beforeRows = await tx
      .select()
      .from(labels)
      .where(and(eq(labels.id, id), eq(labels.workspace_id, workspaceId)))
      .limit(1)
    const before = beforeRows[0]
    if (!before) return null

    if (patch.name !== undefined && patch.name.trim().toLowerCase() !== before.name.toLowerCase()) {
      const dup = await findLabelByName(workspaceId, patch.name)
      if (dup && dup.id !== id) throw new Error('label_exists')
    }

    const updates: Record<string, unknown> = {}
    if (patch.name !== undefined) updates.name = patch.name.trim()
    if (patch.color !== undefined) updates.color = patch.color
    if (patch.description !== undefined) updates.description = patch.description

    if (Object.keys(updates).length === 0) return before

    const [after] = await tx
      .update(labels)
      .set(updates)
      .where(and(eq(labels.id, id), eq(labels.workspace_id, workspaceId)))
      .returning()
    if (!after) return null

    const beforeSnap: Record<string, unknown> = {}
    const afterSnap: Record<string, unknown> = {}
    for (const k of ['name', 'color', 'description'] as const) {
      if ((before as Record<string, unknown>)[k] !== (after as Record<string, unknown>)[k]) {
        beforeSnap[k] = (before as Record<string, unknown>)[k]
        afterSnap[k] = (after as Record<string, unknown>)[k]
      }
    }
    await recordEvent(tx, {
      workspaceId,
      actorUserId,
      entityType: 'label',
      entityId: id,
      action: 'updated',
      diff: { before: beforeSnap, after: afterSnap },
    })
    return after
  })
}

export async function deleteLabel(
  workspaceId: number,
  id: number,
  actorUserId: number
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const beforeRows = await tx
      .select()
      .from(labels)
      .where(and(eq(labels.id, id), eq(labels.workspace_id, workspaceId)))
      .limit(1)
    if (!beforeRows[0]) return false

    await recordEvent(tx, {
      workspaceId,
      actorUserId,
      entityType: 'label',
      entityId: id,
      action: 'deleted',
      diff: { before: { name: beforeRows[0].name } },
    })

    const result = await tx
      .delete(labels)
      .where(and(eq(labels.id, id), eq(labels.workspace_id, workspaceId)))
    return (result.rowCount ?? 0) > 0
  })
}

// ---------- issue-label join ----------

export async function attachLabel(
  workspaceId: number,
  issueId: number,
  labelId: number,
  actorUserId: number
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    // Defense: ensure issue + label both belong to this workspace.
    const ok = await tx
      .select({ i: issues.id })
      .from(issues)
      .where(and(eq(issues.id, issueId), eq(issues.workspace_id, workspaceId)))
      .limit(1)
    if (!ok[0]) return false
    const lbl = await tx
      .select({ id: labels.id, name: labels.name, color: labels.color })
      .from(labels)
      .where(and(eq(labels.id, labelId), eq(labels.workspace_id, workspaceId)))
      .limit(1)
    if (!lbl[0]) return false

    const result = await tx
      .insert(issueLabels)
      .values({ issue_id: issueId, label_id: labelId })
      .onConflictDoNothing({ target: [issueLabels.issue_id, issueLabels.label_id] })
      .returning({ issue_id: issueLabels.issue_id })

    if (result.length === 0) return true // already attached, no-op

    await recordEvent(tx, {
      workspaceId,
      actorUserId,
      entityType: 'issue',
      entityId: issueId,
      action: 'labeled',
      meta: { label_id: labelId, label_name: lbl[0].name, label_color: lbl[0].color },
    })
    return true
  })
}

export async function detachLabel(
  workspaceId: number,
  issueId: number,
  labelId: number,
  actorUserId: number
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const lbl = await tx
      .select({ id: labels.id, name: labels.name })
      .from(labels)
      .where(and(eq(labels.id, labelId), eq(labels.workspace_id, workspaceId)))
      .limit(1)
    if (!lbl[0]) return false

    const result = await tx
      .delete(issueLabels)
      .where(and(eq(issueLabels.issue_id, issueId), eq(issueLabels.label_id, labelId)))

    if ((result.rowCount ?? 0) === 0) return false

    await recordEvent(tx, {
      workspaceId,
      actorUserId,
      entityType: 'issue',
      entityId: issueId,
      action: 'unlabeled',
      meta: { label_id: labelId, label_name: lbl[0].name },
    })
    return true
  })
}

export async function listIssueLabels(issueId: number): Promise<Label[]> {
  const rows = await db
    .select({
      id: labels.id,
      workspace_id: labels.workspace_id,
      name: labels.name,
      color: labels.color,
      description: labels.description,
      created_by: labels.created_by,
      created_at: labels.created_at,
    })
    .from(issueLabels)
    .innerJoin(labels, eq(labels.id, issueLabels.label_id))
    .where(eq(issueLabels.issue_id, issueId))
    .orderBy(labels.name)
  return rows
}

void inArray
