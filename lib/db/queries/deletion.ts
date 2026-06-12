// Recycle bin engine — soft-delete, restore (batch-aware, conflict-resolving),
// and manual purge for issues, projects, and milestones.
//
// Model
// -----
// A soft-delete stamps deleted_at/deleted_by/delete_batch_id on the row and
// keeps it. Because the row survives, its FK columns (project_id, milestone_id)
// survive too — so cascade-deleted children re-link to their parent
// automatically on restore, and an issue's seq is never freed (no restore
// collision).
//
// Every delete is recorded as a `deletion_batch` with a `mode`:
//   - 'cascade': the root's children were binned in the same batch (FKs kept).
//   - 'detach' : the children stayed active; their link to the root was nulled.
// The batch lets restore be smart: items binned together with their parent
// restore as a group (links preserved); items binned alone restore standalone.
//
// Purge is the only destructive op — it hard-deletes the row (the existing FK
// cascades wipe comments/attachments/labels/watchers for issues; SET NULL
// detaches children for projects/milestones). Purge is gated to owners at the
// route layer.

import { and, desc, eq, inArray, isNull, isNotNull, sql } from 'drizzle-orm'
import { db } from '../client'
import { deletionBatches, issues, milestones, projects } from '../schema'
import { recordEvent } from './events'

export type TrashType = 'issue' | 'project' | 'milestone'
export type DeleteMode = 'cascade' | 'detach'
export type RestoreResolution = 'restore_parent' | 'standalone'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface EntityRef {
  type: TrashType
  id: number
}

export interface ChildCounts {
  issues: number
  milestones: number
}

export interface TrashItem {
  type: TrashType
  id: number
  title: string
  seq: number | null
  status: string | null
  deleted_at: string
  deleted_by_id: number | null
  deleted_by_name: string | null
  batch_id: number | null
  batch_mode: DeleteMode | null
  batch_root_type: TrashType | null
  batch_root_id: number | null
  project_id: number | null
  milestone_id: number | null
}

// --------------------------------------------------------------------------
// Soft delete
// --------------------------------------------------------------------------

async function createBatch(
  tx: Tx,
  workspaceId: number,
  actorUserId: number | null,
  mode: DeleteMode,
  rootType: TrashType,
  rootId: number
): Promise<number> {
  const [row] = await tx
    .insert(deletionBatches)
    .values({
      workspace_id: workspaceId,
      actor_user_id: actorUserId,
      mode,
      root_type: rootType,
      root_id: rootId,
    })
    .returning({ id: deletionBatches.id })
  if (!row) throw new Error('deletion_batch insert returned nothing')
  return row.id
}

// Count the active (non-binned) children of a project or milestone. Drives the
// "delete N issues / M milestones too?" dialog.
export async function previewDeletion(
  workspaceId: number,
  rootType: TrashType,
  rootId: number
): Promise<ChildCounts> {
  if (rootType === 'issue') return { issues: 0, milestones: 0 }
  if (rootType === 'milestone') {
    const [r] = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(issues)
      .where(
        and(
          eq(issues.workspace_id, workspaceId),
          eq(issues.milestone_id, rootId),
          isNull(issues.deleted_at)
        )
      )
    return { issues: Number(r?.n ?? 0), milestones: 0 }
  }
  const [iss] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(issues)
    .where(
      and(eq(issues.workspace_id, workspaceId), eq(issues.project_id, rootId), isNull(issues.deleted_at))
    )
  const [ms] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(milestones)
    .where(
      and(
        eq(milestones.workspace_id, workspaceId),
        eq(milestones.project_id, rootId),
        isNull(milestones.deleted_at)
      )
    )
  return { issues: Number(iss?.n ?? 0), milestones: Number(ms?.n ?? 0) }
}

export async function softDeleteIssue(
  workspaceId: number,
  id: number,
  actorUserId: number
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(issues)
      .where(and(eq(issues.id, id), eq(issues.workspace_id, workspaceId), isNull(issues.deleted_at)))
      .limit(1)
    if (!before) return false

    const batchId = await createBatch(tx, workspaceId, actorUserId, 'detach', 'issue', id)
    await tx
      .update(issues)
      .set({ deleted_at: new Date(), deleted_by: actorUserId, delete_batch_id: batchId })
      .where(eq(issues.id, id))

    await recordEvent(tx, {
      workspaceId,
      actorUserId,
      entityType: 'issue',
      entityId: id,
      action: 'deleted',
      meta: { seq: before.seq, title: before.title, batch_id: batchId },
    })
    return true
  })
}

export async function softDeleteProject(
  workspaceId: number,
  id: number,
  actorUserId: number,
  mode: DeleteMode = 'detach'
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(projects)
      .where(
        and(eq(projects.id, id), eq(projects.workspace_id, workspaceId), isNull(projects.deleted_at))
      )
      .limit(1)
    if (!before) return false

    const batchId = await createBatch(tx, workspaceId, actorUserId, mode, 'project', id)
    const now = new Date()

    if (mode === 'cascade') {
      // Bin the active children into the same batch, keeping their FKs intact so
      // restore re-links them.
      await tx
        .update(issues)
        .set({ deleted_at: now, deleted_by: actorUserId, delete_batch_id: batchId })
        .where(
          and(
            eq(issues.workspace_id, workspaceId),
            eq(issues.project_id, id),
            isNull(issues.deleted_at)
          )
        )
      await tx
        .update(milestones)
        .set({ deleted_at: now, deleted_by: actorUserId, delete_batch_id: batchId })
        .where(
          and(
            eq(milestones.workspace_id, workspaceId),
            eq(milestones.project_id, id),
            isNull(milestones.deleted_at)
          )
        )
    } else {
      // Detach: children stay active but lose their link to this project.
      await tx
        .update(issues)
        .set({ project_id: null })
        .where(
          and(
            eq(issues.workspace_id, workspaceId),
            eq(issues.project_id, id),
            isNull(issues.deleted_at)
          )
        )
      await tx
        .update(milestones)
        .set({ project_id: null })
        .where(
          and(
            eq(milestones.workspace_id, workspaceId),
            eq(milestones.project_id, id),
            isNull(milestones.deleted_at)
          )
        )
    }

    await tx
      .update(projects)
      .set({ deleted_at: now, deleted_by: actorUserId, delete_batch_id: batchId })
      .where(eq(projects.id, id))

    await recordEvent(tx, {
      workspaceId,
      actorUserId,
      entityType: 'project',
      entityId: id,
      action: 'deleted',
      diff: { before: { name: before.name, status: before.status } },
      meta: { mode, batch_id: batchId },
    })
    return true
  })
}

export async function softDeleteMilestone(
  workspaceId: number,
  id: number,
  actorUserId: number,
  mode: DeleteMode = 'detach'
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(milestones)
      .where(
        and(
          eq(milestones.id, id),
          eq(milestones.workspace_id, workspaceId),
          isNull(milestones.deleted_at)
        )
      )
      .limit(1)
    if (!before) return false

    const batchId = await createBatch(tx, workspaceId, actorUserId, mode, 'milestone', id)
    const now = new Date()

    if (mode === 'cascade') {
      await tx
        .update(issues)
        .set({ deleted_at: now, deleted_by: actorUserId, delete_batch_id: batchId })
        .where(
          and(
            eq(issues.workspace_id, workspaceId),
            eq(issues.milestone_id, id),
            isNull(issues.deleted_at)
          )
        )
    } else {
      await tx
        .update(issues)
        .set({ milestone_id: null })
        .where(
          and(
            eq(issues.workspace_id, workspaceId),
            eq(issues.milestone_id, id),
            isNull(issues.deleted_at)
          )
        )
    }

    await tx
      .update(milestones)
      .set({ deleted_at: now, deleted_by: actorUserId, delete_batch_id: batchId })
      .where(eq(milestones.id, id))

    await recordEvent(tx, {
      workspaceId,
      actorUserId,
      entityType: 'milestone',
      entityId: id,
      action: 'deleted',
      diff: { before: { name: before.name } },
      meta: { mode, batch_id: batchId },
    })
    return true
  })
}

export function softDeleteEntity(
  workspaceId: number,
  type: TrashType,
  id: number,
  actorUserId: number,
  mode: DeleteMode = 'detach'
): Promise<boolean> {
  if (type === 'issue') return softDeleteIssue(workspaceId, id, actorUserId)
  if (type === 'project') return softDeleteProject(workspaceId, id, actorUserId, mode)
  return softDeleteMilestone(workspaceId, id, actorUserId, mode)
}

// --------------------------------------------------------------------------
// Trash listing
// --------------------------------------------------------------------------

export async function listTrash(
  workspaceId: number,
  opts: { type?: TrashType; limit?: number; offset?: number } = {}
): Promise<TrashItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000)
  const offset = Math.max(opts.offset ?? 0, 0)
  const typeFilter = opts.type ? sql`AND src.type = ${opts.type}` : sql``

  const result = await db.execute(sql`
    WITH src AS (
      SELECT 'issue' AS type, i.id, i.title AS title, i.seq, i.status,
             i.deleted_at, i.deleted_by, i.delete_batch_id, i.project_id, i.milestone_id
      FROM issues i
      WHERE i.workspace_id = ${workspaceId} AND i.deleted_at IS NOT NULL
      UNION ALL
      SELECT 'project', p.id, p.name, NULL, p.status,
             p.deleted_at, p.deleted_by, p.delete_batch_id, NULL, NULL
      FROM projects p
      WHERE p.workspace_id = ${workspaceId} AND p.deleted_at IS NOT NULL
      UNION ALL
      SELECT 'milestone', m.id, m.name, NULL, m.status,
             m.deleted_at, m.deleted_by, m.delete_batch_id, m.project_id, NULL
      FROM milestones m
      WHERE m.workspace_id = ${workspaceId} AND m.deleted_at IS NOT NULL
    )
    SELECT src.*, du.name AS deleted_by_name,
           b.mode AS batch_mode, b.root_type AS batch_root_type, b.root_id AS batch_root_id
    FROM src
    LEFT JOIN users du ON du.id = src.deleted_by
    LEFT JOIN deletion_batches b ON b.id = src.delete_batch_id
    WHERE 1=1 ${typeFilter}
    ORDER BY src.deleted_at DESC, src.type ASC, src.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  return (result.rows as Array<Record<string, unknown>>).map((r) => ({
    type: r.type as TrashType,
    id: Number(r.id),
    title: (r.title as string) ?? '',
    seq: r.seq != null ? Number(r.seq) : null,
    status: (r.status as string | null) ?? null,
    deleted_at: r.deleted_at as string,
    deleted_by_id: r.deleted_by != null ? Number(r.deleted_by) : null,
    deleted_by_name: (r.deleted_by_name as string | null) ?? null,
    batch_id: r.delete_batch_id != null ? Number(r.delete_batch_id) : null,
    batch_mode: (r.batch_mode as DeleteMode | null) ?? null,
    batch_root_type: (r.batch_root_type as TrashType | null) ?? null,
    batch_root_id: r.batch_root_id != null ? Number(r.batch_root_id) : null,
    project_id: r.project_id != null ? Number(r.project_id) : null,
    milestone_id: r.milestone_id != null ? Number(r.milestone_id) : null,
  }))
}

// --------------------------------------------------------------------------
// Restore (with conflict detection)
// --------------------------------------------------------------------------

export interface RestoreConflict {
  type: TrashType
  id: number
  title: string
  parent_type: TrashType
  parent_id: number
  parent_title: string | null
  // parent_binned: parent is itself in the bin; parent_missing: parent row is
  // gone (purged) — the link will be cleared on restore.
  kind: 'parent_binned' | 'parent_missing'
  suggested: RestoreResolution
}

export interface RestorePreview {
  items: EntityRef[]
  conflicts: RestoreConflict[]
}

interface BinnedRow {
  id: number
  title: string
  project_id: number | null
  milestone_id: number | null
  delete_batch_id: number | null
  deleted: boolean // deleted_at IS NOT NULL (still binned)
}

async function loadRow(
  ex: Tx | typeof db,
  workspaceId: number,
  type: TrashType,
  id: number
): Promise<BinnedRow | null> {
  if (type === 'issue') {
    const [r] = await ex
      .select({
        id: issues.id,
        title: issues.title,
        project_id: issues.project_id,
        milestone_id: issues.milestone_id,
        delete_batch_id: issues.delete_batch_id,
        deleted_at: issues.deleted_at,
      })
      .from(issues)
      .where(and(eq(issues.id, id), eq(issues.workspace_id, workspaceId)))
      .limit(1)
    if (!r) return null
    return { ...r, deleted: r.deleted_at != null } as BinnedRow
  }
  if (type === 'milestone') {
    const [r] = await ex
      .select({
        id: milestones.id,
        title: milestones.name,
        project_id: milestones.project_id,
        delete_batch_id: milestones.delete_batch_id,
        deleted_at: milestones.deleted_at,
      })
      .from(milestones)
      .where(and(eq(milestones.id, id), eq(milestones.workspace_id, workspaceId)))
      .limit(1)
    if (!r) return null
    return { id: r.id, title: r.title, project_id: r.project_id, milestone_id: null, delete_batch_id: r.delete_batch_id, deleted: r.deleted_at != null }
  }
  const [r] = await ex
    .select({
      id: projects.id,
      title: projects.name,
      delete_batch_id: projects.delete_batch_id,
      deleted_at: projects.deleted_at,
    })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.workspace_id, workspaceId)))
    .limit(1)
  if (!r) return null
  return { id: r.id, title: r.title, project_id: null, milestone_id: null, delete_batch_id: r.delete_batch_id, deleted: r.deleted_at != null }
}

// Batch-aware default: if the child was binned in the SAME batch as its parent,
// they went together → restore the parent too. Otherwise the child was binned
// alone → bring it back standalone (detach the dangling link).
function defaultResolution(childBatchId: number | null, parentRow: BinnedRow | null): RestoreResolution {
  if (!parentRow) return 'standalone' // parent purged/missing
  if (childBatchId != null && parentRow.delete_batch_id === childBatchId) return 'restore_parent'
  return 'standalone'
}

// Compute conflicts for a set of items WITHOUT mutating anything. A binned
// parent that is ALSO in the selection (same batch, or the user picked both) is
// not a conflict — it will be restored alongside, link intact.
export async function previewRestore(
  workspaceId: number,
  refs: EntityRef[]
): Promise<RestorePreview> {
  const sel = new Set(refs.map((r) => `${r.type}:${r.id}`))
  const conflicts: RestoreConflict[] = []
  for (const ref of refs) {
    const row = await loadRow(db, workspaceId, ref.type, ref.id)
    if (!row || !row.deleted) continue
    if ((ref.type === 'issue' || ref.type === 'milestone') && row.project_id != null) {
      if (!sel.has(`project:${row.project_id}`)) {
        const parent = await loadRow(db, workspaceId, 'project', row.project_id)
        if (!parent) {
          conflicts.push({ type: ref.type, id: ref.id, title: row.title, parent_type: 'project', parent_id: row.project_id, parent_title: null, kind: 'parent_missing', suggested: 'standalone' })
        } else if (parent.deleted) {
          conflicts.push({ type: ref.type, id: ref.id, title: row.title, parent_type: 'project', parent_id: row.project_id, parent_title: parent.title, kind: 'parent_binned', suggested: defaultResolution(row.delete_batch_id, parent) })
        }
      }
    }
    if (ref.type === 'issue' && row.milestone_id != null) {
      if (!sel.has(`milestone:${row.milestone_id}`)) {
        const parent = await loadRow(db, workspaceId, 'milestone', row.milestone_id)
        if (!parent) {
          conflicts.push({ type: ref.type, id: ref.id, title: row.title, parent_type: 'milestone', parent_id: row.milestone_id, parent_title: null, kind: 'parent_missing', suggested: 'standalone' })
        } else if (parent.deleted) {
          conflicts.push({ type: ref.type, id: ref.id, title: row.title, parent_type: 'milestone', parent_id: row.milestone_id, parent_title: parent.title, kind: 'parent_binned', suggested: defaultResolution(row.delete_batch_id, parent) })
        }
      }
    }
  }
  return { items: refs, conflicts }
}

function clearDeleteCols(): { deleted_at: null; deleted_by: null; delete_batch_id: null; position: null } {
  return { deleted_at: null, deleted_by: null, delete_batch_id: null, position: null }
}

// Restore a single entity, recursing into a binned parent when the resolution
// says so. `resolutions` is keyed "type:id" → how to treat that item's binned
// parents. Defaults are batch-aware. `restored` guards against cycles / repeats.
async function restoreEntity(
  tx: Tx,
  workspaceId: number,
  type: TrashType,
  id: number,
  actorUserId: number,
  resolutions: Record<string, RestoreResolution>,
  selection: Set<string>,
  restored: Set<string>
): Promise<void> {
  const key = `${type}:${id}`
  if (restored.has(key)) return
  const row = await loadRow(tx, workspaceId, type, id)
  if (!row) {
    restored.add(key)
    return
  }
  if (!row.deleted) {
    // Already active — nothing to restore, but mark so children can link to it.
    restored.add(key)
    return
  }

  let nextProjectId = row.project_id
  let nextMilestoneId = row.milestone_id

  // A parent that's part of this same restore (selection/batch) is always
  // brought back and re-linked; only a parent NOT being restored falls to the
  // explicit resolution / batch-aware default.
  if (type === 'issue' || type === 'milestone') {
    if (row.project_id != null) {
      const parent = await loadRow(tx, workspaceId, 'project', row.project_id)
      if (parent && parent.deleted) {
        const res = selection.has(`project:${row.project_id}`)
          ? 'restore_parent'
          : resolutions[key] ?? defaultResolution(row.delete_batch_id, parent)
        if (res === 'restore_parent') {
          await restoreEntity(tx, workspaceId, 'project', row.project_id, actorUserId, resolutions, selection, restored)
        } else {
          nextProjectId = null
        }
      } else if (!parent) {
        nextProjectId = null
      }
    }
  }
  if (type === 'issue' && row.milestone_id != null) {
    const parent = await loadRow(tx, workspaceId, 'milestone', row.milestone_id)
    if (parent && parent.deleted) {
      const res = selection.has(`milestone:${row.milestone_id}`)
        ? 'restore_parent'
        : resolutions[key] ?? defaultResolution(row.delete_batch_id, parent)
      if (res === 'restore_parent') {
        await restoreEntity(tx, workspaceId, 'milestone', row.milestone_id, actorUserId, resolutions, selection, restored)
      } else {
        nextMilestoneId = null
      }
    } else if (!parent) {
      nextMilestoneId = null
    }
  }

  const table = type === 'issue' ? issues : type === 'milestone' ? milestones : projects
  const set: Record<string, unknown> = { ...clearDeleteCols() }
  if (type === 'issue') {
    set.project_id = nextProjectId
    set.milestone_id = nextMilestoneId
  } else if (type === 'milestone') {
    set.project_id = nextProjectId
  }
  await tx.update(table).set(set).where(eq(table.id, id))

  await recordEvent(tx, {
    workspaceId,
    actorUserId,
    entityType: type,
    entityId: id,
    action: 'restored',
    meta: { title: row.title },
  })
  restored.add(key)
}

export async function restoreItems(
  workspaceId: number,
  refs: EntityRef[],
  actorUserId: number,
  resolutions: Record<string, RestoreResolution> = {}
): Promise<{ restored: EntityRef[] }> {
  return await db.transaction(async (tx) => {
    const restored = new Set<string>()
    const selection = new Set(refs.map((r) => `${r.type}:${r.id}`))
    // Restore projects first, then milestones, then issues, so parents exist as
    // active rows before children link to them.
    const order: TrashType[] = ['project', 'milestone', 'issue']
    const sorted = [...refs].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
    for (const ref of sorted) {
      await restoreEntity(tx, workspaceId, ref.type, ref.id, actorUserId, resolutions, selection, restored)
    }
    const result: EntityRef[] = []
    for (const k of restored) {
      const [t, idStr] = k.split(':')
      result.push({ type: t as TrashType, id: Number(idStr) })
    }
    return { restored: result }
  })
}

// Restore every still-binned member of a batch. Within a batch, parent and
// children share the batch id, so the batch-aware default re-links them.
export async function restoreBatch(
  workspaceId: number,
  batchId: number,
  actorUserId: number
): Promise<{ restored: EntityRef[] }> {
  const refs = await batchMembers(workspaceId, batchId)
  return restoreItems(workspaceId, refs, actorUserId)
}

export async function batchMembers(workspaceId: number, batchId: number): Promise<EntityRef[]> {
  const refs: EntityRef[] = []
  const pr = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.workspace_id, workspaceId), eq(projects.delete_batch_id, batchId), isNotNull(projects.deleted_at)))
  refs.push(...pr.map((r) => ({ type: 'project' as const, id: r.id })))
  const ms = await db
    .select({ id: milestones.id })
    .from(milestones)
    .where(and(eq(milestones.workspace_id, workspaceId), eq(milestones.delete_batch_id, batchId), isNotNull(milestones.deleted_at)))
  refs.push(...ms.map((r) => ({ type: 'milestone' as const, id: r.id })))
  const iss = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.workspace_id, workspaceId), eq(issues.delete_batch_id, batchId), isNotNull(issues.deleted_at)))
  refs.push(...iss.map((r) => ({ type: 'issue' as const, id: r.id })))
  return refs
}

// --------------------------------------------------------------------------
// Purge (permanent) — owner-gated at the route layer
// --------------------------------------------------------------------------

// Purge the given items. Only rows already in the bin (deleted_at IS NOT NULL)
// are touched, so a stray active id can never be hard-deleted here. Issues are
// purged before projects/milestones so FK SET NULL doesn't orphan a parent's
// binned children mid-batch.
export async function purgeItems(
  workspaceId: number,
  refs: EntityRef[],
  actorUserId: number
): Promise<{ purged: number }> {
  return await db.transaction(async (tx) => {
    let purged = 0
    const order: TrashType[] = ['issue', 'milestone', 'project']
    const sorted = [...refs].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
    for (const ref of sorted) {
      const ok = await purgeOne(tx, workspaceId, ref.type, ref.id, actorUserId)
      if (ok) purged++
    }
    return { purged }
  })
}

async function purgeOne(
  tx: Tx,
  workspaceId: number,
  type: TrashType,
  id: number,
  actorUserId: number
): Promise<boolean> {
  const table = type === 'issue' ? issues : type === 'milestone' ? milestones : projects
  const [before] = await tx
    .select()
    .from(table)
    .where(and(eq(table.id, id), eq(table.workspace_id, workspaceId), isNotNull(table.deleted_at)))
    .limit(1)
  if (!before) return false

  // Record the purge BEFORE the hard delete so the FK cascade can't wipe it
  // (events cascade with the workspace, not with these entities).
  await recordEvent(tx, {
    workspaceId,
    actorUserId,
    entityType: type,
    entityId: id,
    action: 'purged',
    meta: { title: (before as { title?: string; name?: string }).title ?? (before as { name?: string }).name ?? null },
  })

  const result = await tx.delete(table).where(and(eq(table.id, id), eq(table.workspace_id, workspaceId)))
  return (result.rowCount ?? 0) > 0
}

export async function purgeBatch(
  workspaceId: number,
  batchId: number,
  actorUserId: number
): Promise<{ purged: number }> {
  const refs = await batchMembers(workspaceId, batchId)
  return purgeItems(workspaceId, refs, actorUserId)
}

// Permanently delete everything in the bin for this workspace. Owner-only.
export async function emptyTrash(
  workspaceId: number,
  actorUserId: number
): Promise<{ purged: number }> {
  const all = await listTrash(workspaceId, { limit: 1000 })
  // listTrash caps at 1000; loop until the bin is dry so very large bins fully
  // empty.
  let total = 0
  let page = all
  while (page.length > 0) {
    const { purged } = await purgeItems(
      workspaceId,
      page.map((i) => ({ type: i.type, id: i.id })),
      actorUserId
    )
    total += purged
    if (page.length < 1000) break
    page = await listTrash(workspaceId, { limit: 1000 })
  }
  return { purged: total }
}
