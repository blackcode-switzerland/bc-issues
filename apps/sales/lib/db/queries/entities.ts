// This app's half of the cross-app entity projection.
//
// `@blackcode/platform-db` owns the table, the URN format and the upsert. What
// lives here is the one thing platform must never learn: **this app's URL scheme
// and this app's source tables**. A platform package that knew where a prospect
// lives in the dashboard would be a platform package that knew about one app.
//
// This is what buys the north star — `bk search acme` finding a sales prospect
// from an issues context, and
// `bk link create bc:sales:acme/prospect/12 bc:issues:acme/issue/512 --rel blocks`.
//
// ---------------------------------------------------------------------------
// THE RULE THIS FILE EXISTS TO ENFORCE
// ---------------------------------------------------------------------------
// Every function here takes a transaction handle and never opens one. Call it
// from inside the transaction that writes the source row, always:
//
//     return await db.transaction(async (tx) => {
//       const seq = await allocateSeq(tx, workspaceId, 'prospect')
//       const [row] = await tx.insert(prospects).values({ …, seq }).returning()
//       await recordEvent(tx, …)
//       await projectEntity(tx, { … })      // <- same tx, not after it
//       return row
//     })
//
// A projection written outside the transaction commits even when the source
// write rolls back, and the result is an entities row for a prospect that does
// not exist. That failure is invisible: `bk search` returns a title, the link
// resolves, and nothing is wrong until somebody clicks through to a 404 weeks
// later. `entities.projection.test.ts` asserts the rollback case directly.
//
// The second guard is `reconcileEntities`, `bk super-admin entity-drift`, which
// re-derives the projection from the source tables.

import { sql } from 'drizzle-orm'
import {
  getEntityContext,
  purgeEntity,
  setEntityDeletedAt,
  upsertEntity,
  type Executor,
} from '@blackcode/platform-db'
import { communications, documents, entities, meetings, products, prospects, templates } from '../schema'
import { APP_SLUG } from '@/lib/app'
import {
  ENTITY_TYPES,
  entityPath,
  entityUrn,
  entityUrnOrNull,
  type SalesEntityType,
} from '@/lib/entity-address'

// The address scheme itself lives in lib/entity-address.ts — pure functions, no
// database import, so it can be unit-tested without one. Re-exported here so a
// caller wiring up a write path has a single import site.
export {
  ENTITY_TYPES,
  entityPath,
  entityUrn,
  entityUrnOrNull,
  type SalesEntityType,
} from '@/lib/entity-address'

// `Executor` is platform-db's narrow shape that both `db` and a `tx` handle
// satisfy — re-exported so a caller wiring up a new write path does not have to
// reach into the package to name the parameter type.
export type { Executor }

export interface ProjectEntityInput {
  workspaceId: number
  entityType: SalesEntityType
  /** The workspace #number (`seq`), never the row id. */
  number: number | null | undefined
  title: string
  deletedAt?: Date | null
}

/**
 * Mirror one prospect/meeting/communication/product/template/document into
 * `platform.entities`. Idempotent.
 *
 * Returns the URN, or null when the row cannot be addressed. **Never throws**:
 * the projection must not be able to fail the write it is projecting. An
 * unaddressable row loses its projection and the reconciler reports it as
 * `missing`, which is a problem someone can see and fix.
 */
export async function projectEntity(
  tx: Executor,
  input: ProjectEntityInput
): Promise<string | null> {
  if (input.number == null) return null
  const ctx = await getEntityContext(tx, APP_SLUG, input.workspaceId)
  if (!ctx) return null
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
    entityType: SalesEntityType
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
  args: { workspaceId: number; entityType: SalesEntityType; number: number | null | undefined }
): Promise<void> {
  if (args.number == null) return
  await purgeEntity(tx, {
    app: APP_SLUG,
    workspaceId: args.workspaceId,
    entityType: args.entityType,
    number: args.number,
  })
}

/**
 * The source table behind each projected type.
 *
 * ONE map, so a seventh entity type is one line rather than a switch statement
 * in every function below — and, more importantly, so `ENTITY_TYPES` and the
 * tables it implies cannot drift apart: `Record<SalesEntityType, …>` makes a
 * missing entry a compile error rather than an entity type that is projected on
 * write and never reconciled.
 *
 * Every table here has `workspace_id`, `seq` and `deleted_at`, which is exactly
 * what the two functions below need and exactly what makes a type projectable.
 */
type SourceTable =
  | typeof prospects
  | typeof meetings
  | typeof communications
  | typeof products
  | typeof templates
  | typeof documents

const SOURCE: Record<SalesEntityType, { table: SourceTable }> = {
  prospect: { table: prospects },
  meeting: { table: meetings },
  communication: { table: communications },
  product: { table: products },
  template: { table: templates },
  document: { table: documents },
}

/**
 * Re-derive `deleted_at` in the projection from the source tables, for one
 * workspace. Call it at the end of any transaction that bins or restores rows.
 *
 * WHY THIS SHAPE, rather than passing the affected #numbers: binning a prospect
 * cascades to its meetings, communications and documents by predicate — there is
 * no list of affected rows, and building one would mean the next person who adds
 * a cascade branch has to remember to extend it. They will not, and the failure
 * is silent: a binned prospect still showing up in `bk search`. Re-deriving the
 * whole workspace cannot miss a row, and the `IS NULL <> IS NULL` guard means it
 * only writes the rows that actually disagree.
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
 * Same reasoning as `syncEntityDeletedState`: a purge hard-deletes by predicate,
 * so the reliable question is "which projections no longer have a source row",
 * not "which rows did we just delete". Links to the purged entity cascade with
 * it.
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
