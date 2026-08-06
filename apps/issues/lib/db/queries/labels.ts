// Label queries — workspace-scoped AND app-scoped. Labels are shared across all
// projects in the workspace and can be applied to issues directly. The legacy
// project_id column is no longer required.
//
// Names are case-insensitive unique within a workspace (enforced at the
// application layer; Phase 13 cleanup will add a partial unique index).
//
// ---------------------------------------------------------------------------
// THE APP LENS (0043, D-14) — IT IS ON EVERY READ, NOT JUST THE LIST
// ---------------------------------------------------------------------------
// `platform.labels.app` is NULL for a label shared across every app in the
// workspace, and the app's slug for one scoped to it. `VISIBLE_TO_THIS_APP` is
// that predicate and belongs on EVERY query in this file, because "read path"
// here does not mean "the list route":
//
//   - the dup check behind create/rename would otherwise refuse a name another
//     app owns, leaking that app's label set through a 409;
//   - update/delete would otherwise let this app rename or destroy another
//     app's label by id;
//   - attach would otherwise put a foreign app's label on an issue, which is
//     the one failure D-14's `bk <app> label` spelling promises cannot happen.
//
// Creation stamps `app: APP_SLUG`, and nothing in this app ever writes NULL —
// deliberately. 0043 claimed every pre-existing label for this app, so `NULL`
// has no instances today and every shared label that ever exists will be one
// somebody made shared on purpose (`UPDATE … SET app = NULL`, by hand). That is
// the point: sharing is a decision about one label, not a default, and a --shared
// flag would turn it back into one.
//
// `labels.app-scope.test.ts` enumerates the paths and asserts BOTH halves of the
// predicate — that another app's labels are hidden, AND that this app's own are
// still shown. A filter that hid everything would pass the first half alone.

import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { db } from '../client'
import { issueLabels, issues, labels, type Label } from '../schema'
import { recordEvent } from './events'
import { APP_SLUG } from '@/lib/app'

/** `app IS NULL OR app = 'issues'` — shared labels, plus this app's own. */
export const VISIBLE_TO_THIS_APP: SQL = sql`(${labels.app} IS NULL OR ${labels.app} = ${APP_SLUG})`

/**
 * The same predicate for the reads written in raw SQL, which address the table
 * through an alias (`l`, `lb`) rather than through the drizzle symbol.
 */
export function visibleToThisApp(alias: string): SQL {
  const col = sql.raw(`${alias}.app`)
  return sql`(${col} IS NULL OR ${col} = ${APP_SLUG})`
}

export interface LabelListItem extends Label {
  issue_count: number
}

export async function listLabelsInWorkspace(workspaceId: number): Promise<LabelListItem[]> {
  const rows = await db.execute(sql`
    SELECT l.*,
      (SELECT COUNT(*)::int FROM ${issueLabels} il
        INNER JOIN ${issues} i ON i.id = il.issue_id
        WHERE il.label_id = l.id AND i.workspace_id = ${workspaceId}
          AND i.deleted_at IS NULL) AS issue_count
    FROM ${labels} l
    WHERE l.workspace_id = ${workspaceId} AND ${visibleToThisApp('l')}
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
    .where(and(eq(labels.id, id), eq(labels.workspace_id, workspaceId), VISIBLE_TO_THIS_APP))
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
        VISIBLE_TO_THIS_APP,
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
        app: APP_SLUG,
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

// Transaction-scoped: resolve a list of label NAMES to ids, creating any that
// don't already exist in the workspace (case-insensitive match). Lets issues be
// created or labeled with new labels on the fly. Names are assumed pre-trimmed
// and length-validated by the caller.
type Tx = Pick<typeof db, 'insert' | 'select' | 'update' | 'delete' | 'execute'>

export async function resolveOrCreateLabels(
  tx: Tx,
  workspaceId: number,
  names: string[],
  actorUserId: number
): Promise<number[]> {
  const ids: number[] = []
  const seen = new Set<string>()
  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const existing = await tx
      .select({ id: labels.id })
      .from(labels)
      .where(
        and(
          eq(labels.workspace_id, workspaceId),
          VISIBLE_TO_THIS_APP,
          sql`lower(${labels.name}) = ${key}`
        )
      )
      .limit(1)
    if (existing[0]) {
      ids.push(existing[0].id)
      continue
    }

    const [created] = await tx
      .insert(labels)
      .values({ workspace_id: workspaceId, app: APP_SLUG, name, color: '#6b7280', created_by: actorUserId })
      .returning({ id: labels.id, name: labels.name, color: labels.color })
    if (!created) continue
    ids.push(created.id)
    await recordEvent(tx, {
      workspaceId,
      actorUserId,
      entityType: 'label',
      entityId: created.id,
      action: 'created',
      diff: { after: { name: created.name, color: created.color } },
    })
  }
  return ids
}

// Non-transactional wrapper for callers that aren't already inside one.
export async function getOrCreateLabels(
  workspaceId: number,
  names: string[],
  actorUserId: number
): Promise<number[]> {
  return await db.transaction((tx) => resolveOrCreateLabels(tx, workspaceId, names, actorUserId))
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
      .where(and(eq(labels.id, id), eq(labels.workspace_id, workspaceId), VISIBLE_TO_THIS_APP))
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
      .where(and(eq(labels.id, id), eq(labels.workspace_id, workspaceId), VISIBLE_TO_THIS_APP))
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
      .where(and(eq(labels.id, id), eq(labels.workspace_id, workspaceId), VISIBLE_TO_THIS_APP))
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
      .where(and(eq(labels.id, id), eq(labels.workspace_id, workspaceId), VISIBLE_TO_THIS_APP))
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
      .where(
        and(eq(issues.id, issueId), eq(issues.workspace_id, workspaceId), isNull(issues.deleted_at))
      )
      .limit(1)
    if (!ok[0]) return false
    const lbl = await tx
      .select({ id: labels.id, name: labels.name, color: labels.color })
      .from(labels)
      .where(and(eq(labels.id, labelId), eq(labels.workspace_id, workspaceId), VISIBLE_TO_THIS_APP))
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
      .where(and(eq(labels.id, labelId), eq(labels.workspace_id, workspaceId), VISIBLE_TO_THIS_APP))
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
      app: labels.app,
      created_by: labels.created_by,
      created_at: labels.created_at,
    })
    .from(issueLabels)
    .innerJoin(labels, eq(labels.id, issueLabels.label_id))
    .where(and(eq(issueLabels.issue_id, issueId), VISIBLE_TO_THIS_APP))
    .orderBy(labels.name)
  return rows
}

void inArray
