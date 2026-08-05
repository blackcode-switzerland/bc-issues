// This app's half of the cross-app entity projection (Phase 6).
//
// `@blackcode/platform-db` owns the table, the URN format and the upsert. What
// lives here is the one thing platform must never learn: **this app's URL scheme
// and this app's source tables**. A platform package that knew where an issue
// lives in the dashboard would be a platform package that knew about one app.
//
// ---------------------------------------------------------------------------
// THE RULE THIS FILE EXISTS TO ENFORCE
// ---------------------------------------------------------------------------
// Every function here takes a transaction handle and never opens one. Call it
// from inside the transaction that writes the source row, always:
//
//     return await db.transaction(async (tx) => {
//       const [row] = await tx.insert(issues).values(…).returning()
//       await recordEvent(tx, …)
//       await projectEntity(tx, { … })      // <- same tx, not after it
//       return row
//     })
//
// A projection written outside the transaction commits even when the source
// write rolls back, and the result is an entities row for an issue that does not
// exist. That failure is invisible: `bk search` returns a title, the link
// resolves, and nothing is wrong until somebody clicks through to a 404 weeks
// later. `entities.projection.test.ts` asserts the rollback case directly.
//
// The second guard is `reconcileEntities` below, which re-derives the whole
// projection from the source tables. It ships in this phase rather than later
// because there is exactly one writer today — which is the only time you can be
// sure a difference it reports is a bug in the writer and not a race with one.

import { sql } from 'drizzle-orm'
import {
  getEntityContext,
  purgeEntity,
  setEntityDeletedAt,
  upsertEntity,
  absoluteUrl,
  listProjectedEntities,
  type EntityContext,
  type EntityRow,
  type Executor,
} from '@blackcode/platform-db'
import { db } from '../client'
import { entities, issues, projects, tasks, workspaces } from '../schema'
import { APP_SLUG } from '@/lib/app'
import {
  ENTITY_TYPES,
  entityPath,
  entityUrn,
  entityUrnOrNull,
  type IssuesEntityType,
} from '@/lib/entity-address'

// The address scheme itself lives in lib/entity-address.ts — pure functions, no
// database import, so it can be unit-tested without one. Re-exported here so a
// caller wiring up a write path has a single import site.
export {
  ENTITY_TYPES,
  entityPath,
  entityUrn,
  entityUrnOrNull,
  type IssuesEntityType,
} from '@/lib/entity-address'

// `Executor` is platform-db's narrow shape that both `db` and a `tx` handle
// satisfy — re-exported here so a caller wiring up a new write path does not
// have to reach into the package to name the parameter type.
export type { Executor }

export interface ProjectEntityInput {
  workspaceId: number
  entityType: IssuesEntityType
  /** The workspace #number (`seq`), never the row id. */
  number: number | null | undefined
  title: string
  deletedAt?: Date | null
}

/**
 * Mirror one issue/task/project into `platform.entities`. Idempotent.
 *
 * Returns the URN, or null when the row cannot be addressed — which happens for
 * exactly one reason: `seq` is null, on a row predating the #number backfill.
 * Such a row has no URN, so it has no projection, and the reconciler applies the
 * same rule so the two never disagree.
 */
export async function projectEntity(
  tx: Executor,
  input: ProjectEntityInput
): Promise<string | null> {
  if (input.number == null) return null
  const ctx = await getEntityContext(tx, APP_SLUG, input.workspaceId)
  if (!ctx) return null
  // Fail soft: an unaddressable workspace loses its projection (and the
  // reconciler reports it as `missing`), it does not fail the write.
  if (entityUrnOrNull(ctx.workspaceSlug, input.entityType, input.number) == null) {
    console.warn(
      `[entities] skipping projection: workspace slug ${JSON.stringify(ctx.workspaceSlug)} cannot form a URN`
    )
    return null
  }
  return await upsertEntity(tx, {
    app: APP_SLUG,
    workspaceId: input.workspaceId,
    entityType: input.entityType,
    number: input.number,
    title: input.title,
    path: entityPath(ctx.workspaceSlug, input.entityType, input.number),
    workspaceSlug: ctx.workspaceSlug,
    baseUrl: ctx.baseUrl,
    deletedAt: input.deletedAt ?? null,
  })
}

/**
 * Mirror a soft delete or a restore. `deletedAt: null` restores.
 *
 * The projection row stays either way — only `purgeProjectedEntity` removes it.
 * A link into the recycle bin has to survive, because restoring the item has to
 * bring its links back with it.
 */
export async function markEntityDeleted(
  tx: Executor,
  args: {
    workspaceId: number
    entityType: IssuesEntityType
    number: number | null | undefined
    deletedAt: Date | null
  }
): Promise<void> {
  if (args.number == null) return
  await setEntityDeletedAt(
    tx,
    {
      app: APP_SLUG,
      workspaceId: args.workspaceId,
      entityType: args.entityType,
      number: args.number,
    },
    args.deletedAt
  )
}

/** Remove the projection for a purged (hard-deleted) row. Links cascade away. */
export async function purgeProjectedEntity(
  tx: Executor,
  args: { workspaceId: number; entityType: IssuesEntityType; number: number | null | undefined }
): Promise<void> {
  if (args.number == null) return
  await purgeEntity(tx, {
    app: APP_SLUG,
    workspaceId: args.workspaceId,
    entityType: args.entityType,
    number: args.number,
  })
}

// The source table behind each projected type, and the column its title comes
// from. One map, so a fourth type is one line rather than three switch statements.
const SOURCE: Record<IssuesEntityType, { table: typeof issues | typeof tasks | typeof projects }> = {
  issue: { table: issues },
  task: { table: tasks },
  project: { table: projects },
}

/**
 * Re-derive `deleted_at` in the projection from the source tables, for one
 * workspace.
 *
 * Call this at the end of any transaction that bins or restores rows.
 *
 * WHY THIS SHAPE, rather than passing the affected #numbers. Deleting a project
 * in `cascade` mode bins its issues and its tasks by predicate — there is no list
 * of the affected rows, and building one would mean the next person who adds a
 * cascade branch has to remember to extend it. They will not, and the failure is
 * silent: a binned issue that still shows up in `bk search`. Re-deriving the
 * whole workspace's state cannot miss a row, and the `IS NULL <> IS NULL` guard
 * means it only writes the rows that actually disagree, so the cost is an index
 * scan and nothing else.
 */
export async function syncEntityDeletedState(tx: Executor, workspaceId: number): Promise<void> {
  for (const type of ENTITY_TYPES) {
    const table = SOURCE[type].table
    await tx.execute(sql`
      UPDATE ${entities} e
      SET deleted_at = s.deleted_at, updated_at = now()
      FROM ${table} s
      WHERE e.workspace_id = ${workspaceId}
        AND e.app = ${APP_SLUG}
        AND e.entity_type = ${type}
        AND s.workspace_id = e.workspace_id
        AND s.seq = e.number
        AND (e.deleted_at IS NULL) <> (s.deleted_at IS NULL)
    `)
  }
}

/**
 * Drop projections whose source row is gone for good (purged from the bin).
 *
 * Same reasoning as `syncEntityDeletedState`: purging a batch hard-deletes rows
 * by predicate, so the reliable question is "which projections no longer have a
 * source row", not "which rows did we just delete". Links to the purged entity
 * go with it by cascade.
 */
export async function purgeMissingEntities(tx: Executor, workspaceId: number): Promise<void> {
  for (const type of ENTITY_TYPES) {
    const table = SOURCE[type].table
    await tx.execute(sql`
      DELETE FROM ${entities} e
      WHERE e.workspace_id = ${workspaceId}
        AND e.app = ${APP_SLUG}
        AND e.entity_type = ${type}
        AND NOT EXISTS (
          SELECT 1 FROM ${table} s
          WHERE s.workspace_id = e.workspace_id AND s.seq = e.number
        )
    `)
  }
}

/**
 * The URN for an event's subject, from the in-app coordinates an event carries.
 *
 * `recordEvent` calls this so no call site has to remember to pass a URN — there
 * are ~40 of them and one forgetting would be an activity feed with a hole in it
 * that nothing would ever report. Entity types that are not projected entities
 * (comment, label, member, invitation, workspace) resolve to null, which is the
 * correct answer rather than a missing one: they are real events about things
 * that have no cross-app address.
 */
export async function resolveSubjectUrn(
  tx: Executor,
  workspaceId: number,
  entityType: string,
  entityId: number
): Promise<string | null> {
  if (entityType !== 'issue' && entityType !== 'task' && entityType !== 'project') return null
  const table = entityType === 'issue' ? issues : entityType === 'task' ? tasks : projects
  const res = await tx.execute(sql`
    SELECT w.slug AS slug, x.seq AS seq
    FROM ${table} x
    JOIN ${workspaces} w ON w.id = x.workspace_id
    WHERE x.id = ${entityId} AND x.workspace_id = ${workspaceId}
    LIMIT 1
  `)
  const row = res.rows[0]
  if (!row || row.seq == null) return null
  // Null, never a throw — this runs inside recordEvent, which runs inside every
  // create, update and delete. A URN that cannot be built must cost an untagged
  // event, not a failed write.
  return entityUrnOrNull(String(row.slug), entityType, Number(row.seq))
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/** One row the projection and the source tables disagree about. */
export interface EntityDrift {
  urn: string
  workspace_id: number
  entity_type: string
  number: number
  kind: 'missing' | 'stale' | 'orphaned'
  detail: string
}

export interface ReconcileResult {
  /** Source rows that should be projected, per type. */
  source_counts: Record<string, number>
  /** Rows actually in `platform.entities`, per type. */
  projected_counts: Record<string, number>
  drift: EntityDrift[]
  /** How many rows were written, when called with `repair: true`. */
  repaired: number
}

interface SourceRow {
  workspace_id: number
  workspace_slug: string
  entity_type: IssuesEntityType
  number: number
  title: string
  deleted_at: string | null
}

/**
 * Every source row that ought to have a projection, for one workspace or all.
 *
 * This query IS the definition of "should be projected", and migration 0035's
 * backfill uses the same predicate deliberately: a source row is projected when
 * it has a workspace and a `seq`. If the two ever diverge, every reconciliation
 * run reports drift that is not drift, and the report stops being read.
 */
async function sourceRows(exec: Executor, workspaceId: number | null): Promise<SourceRow[]> {
  const wsFilter = workspaceId == null ? sql`` : sql` AND s.workspace_id = ${workspaceId}`
  const res = await exec.execute(sql`
    SELECT s.workspace_id, w.slug AS workspace_slug, s.entity_type, s.number, s.title, s.deleted_at
    FROM (
      SELECT i.workspace_id, 'issue'   AS entity_type, i.seq AS number, i.title AS title, i.deleted_at
        FROM ${issues} i   WHERE i.seq IS NOT NULL AND i.workspace_id IS NOT NULL
      UNION ALL
      SELECT t.workspace_id, 'task'    AS entity_type, t.seq AS number, t.name  AS title, t.deleted_at
        FROM ${tasks} t    WHERE t.seq IS NOT NULL AND t.workspace_id IS NOT NULL
      UNION ALL
      SELECT p.workspace_id, 'project' AS entity_type, p.seq AS number, p.name  AS title, p.deleted_at
        FROM ${projects} p WHERE p.seq IS NOT NULL AND p.workspace_id IS NOT NULL
    ) s
    JOIN ${workspaces} w ON w.id = s.workspace_id
    WHERE true${wsFilter}
    ORDER BY s.workspace_id, s.entity_type, s.number
  `)
  return res.rows.map((r) => ({
    workspace_id: Number(r.workspace_id),
    workspace_slug: String(r.workspace_slug),
    entity_type: String(r.entity_type) as IssuesEntityType,
    number: Number(r.number),
    title: String(r.title),
    deleted_at: r.deleted_at == null ? null : String(r.deleted_at),
  }))
}

function sameDeleted(a: string | null, b: string | null): boolean {
  return (a == null) === (b == null)
}

/**
 * Re-derive the projection from the source tables and report the difference.
 *
 * Three kinds of drift, and the names are chosen so a report says what happened
 * rather than only that something did:
 *
 *   missing  — a source row with no projection. A write path forgot to project.
 *   stale    — title, url or deleted state disagree. A write path updated the
 *              source without updating the projection.
 *   orphaned — a projection with no source row. A delete path purged the source
 *              and left the projection, or a workspace slug changed without the
 *              urn following.
 *
 * With `repair: true` it fixes all three and returns how many rows it touched.
 * The repair is safe to run at any time — it is the same upsert the write paths
 * use — but a repair that fixes something is a BUG REPORT, not routine
 * maintenance: exactly one writer exists today, so anything it finds is that
 * writer being wrong. Log what it repaired.
 */
export async function reconcileEntities(
  opts: { workspaceId?: number | null; repair?: boolean } = {}
): Promise<ReconcileResult> {
  const workspaceId = opts.workspaceId ?? null
  const src = await sourceRows(db, workspaceId)

  const wsIds = [...new Set(src.map((r) => r.workspace_id))]
  if (workspaceId != null && !wsIds.includes(workspaceId)) wsIds.push(workspaceId)

  const projected: EntityRow[] = []
  for (const id of wsIds) {
    projected.push(...(await listProjectedEntities(db, id, APP_SLUG)))
  }

  // Context per workspace, so the expected url can be computed without a lookup
  // per row. base_url is a property of the app, not the workspace, but the slug
  // is not — and both are needed to say what the url should be.
  const ctxByWs = new Map<number, EntityContext>()
  for (const id of wsIds) {
    const ctx = await getEntityContext(db, APP_SLUG, id)
    if (ctx) ctxByWs.set(id, ctx)
  }

  const key = (ws: number, type: string, n: number) => `${ws}:${type}:${n}`
  const projectedByKey = new Map(
    projected.map((p) => [key(p.workspace_id, p.entity_type, p.number), p])
  )
  const sourceKeys = new Set(src.map((r) => key(r.workspace_id, r.entity_type, r.number)))

  const drift: EntityDrift[] = []
  const source_counts: Record<string, number> = {}
  const projected_counts: Record<string, number> = {}
  for (const r of src) source_counts[r.entity_type] = (source_counts[r.entity_type] ?? 0) + 1
  for (const p of projected) {
    projected_counts[p.entity_type] = (projected_counts[p.entity_type] ?? 0) + 1
  }

  const toUpsert: SourceRow[] = []
  for (const r of src) {
    const ctx = ctxByWs.get(r.workspace_id)
    if (!ctx) continue
    // A workspace whose slug cannot form a URN has no projectable entities.
    // Report it rather than throwing: a reconciler that dies partway through is
    // worse than one that says which rows it could not address.
    const urn = entityUrnOrNull(ctx.workspaceSlug, r.entity_type, r.number)
    if (urn == null) {
      drift.push({
        urn: `bc:${APP_SLUG}:?/${r.entity_type}/${r.number}`,
        workspace_id: r.workspace_id,
        entity_type: r.entity_type,
        number: r.number,
        kind: 'missing',
        detail: `workspace slug ${JSON.stringify(ctx.workspaceSlug)} cannot form a URN`,
      })
      continue
    }
    const p = projectedByKey.get(key(r.workspace_id, r.entity_type, r.number))
    if (!p) {
      drift.push({
        urn,
        workspace_id: r.workspace_id,
        entity_type: r.entity_type,
        number: r.number,
        kind: 'missing',
        detail: 'source row has no projection',
      })
      toUpsert.push(r)
      continue
    }
    const expectedUrl = absoluteUrl(ctx.baseUrl, entityPath(ctx.workspaceSlug, r.entity_type, r.number))
    const problems: string[] = []
    if (p.urn !== urn) problems.push(`urn ${p.urn} != ${urn}`)
    if (p.title !== r.title) problems.push('title')
    if (p.url !== expectedUrl) problems.push('url')
    if (!sameDeleted(p.deleted_at, r.deleted_at)) problems.push('deleted_at')
    if (problems.length > 0) {
      drift.push({
        urn,
        workspace_id: r.workspace_id,
        entity_type: r.entity_type,
        number: r.number,
        kind: 'stale',
        detail: problems.join(', '),
      })
      toUpsert.push(r)
    }
  }

  const orphans = projected.filter(
    (p) => !sourceKeys.has(key(p.workspace_id, p.entity_type, p.number))
  )
  for (const p of orphans) {
    drift.push({
      urn: p.urn,
      workspace_id: p.workspace_id,
      entity_type: p.entity_type,
      number: p.number,
      kind: 'orphaned',
      detail: 'projection has no source row',
    })
  }

  let repaired = 0
  if (opts.repair) {
    await db.transaction(async (tx) => {
      for (const r of toUpsert) {
        const ctx = ctxByWs.get(r.workspace_id)
        if (!ctx) continue
        await upsertEntity(tx, {
          app: APP_SLUG,
          workspaceId: r.workspace_id,
          entityType: r.entity_type,
          number: r.number,
          title: r.title,
          path: entityPath(ctx.workspaceSlug, r.entity_type, r.number),
          workspaceSlug: ctx.workspaceSlug,
          baseUrl: ctx.baseUrl,
          deletedAt: r.deleted_at ? new Date(r.deleted_at) : null,
        })
        repaired++
      }
      for (const p of orphans) {
        await purgeEntity(tx, {
          app: APP_SLUG,
          workspaceId: p.workspace_id,
          entityType: p.entity_type,
          number: p.number,
        })
        repaired++
      }
    })
  }

  return { source_counts, projected_counts, drift, repaired }
}
