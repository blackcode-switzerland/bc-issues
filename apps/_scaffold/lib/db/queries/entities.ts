// This app's half of the cross-app entity projection.
//
// `@blackcode/platform-db` owns the table, the URN format and the upsert. What
// lives here is the one thing the platform must never learn: **this app's URL
// scheme and this app's source tables.** A platform package that knew where a
// note lives in the dashboard would be a platform package that knew about one
// app.
//
// This is what buys the north star — `bk search acme` finding this app's rows
// from another app's context, and
// `bk link create bc:scaffold:acme/note/7 bc:issues:acme/issue/512 --rel blocks`.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE RULE THIS FILE EXISTS TO ENFORCE, AND THE ONE THING TO COPY EXACTLY
// ═══════════════════════════════════════════════════════════════════════════
// Every function here takes a transaction handle and NEVER OPENS ONE. Call it
// from inside the transaction that writes the source row, always:
//
//     return await db.transaction(async (tx) => {
//       const seq = await allocateSeq(tx, workspaceId)
//       const [row] = await tx.insert(notes).values({ …, seq }).returning()
//       await projectEntity(tx, { … })      // <- same tx, not after it
//       return row
//     })
//
// A projection written OUTSIDE the transaction commits even when the source
// write rolls back, and the result is an `entities` row for a note that does not
// exist. **That failure is invisible**: `bk search` returns a title, the link
// resolves, and nothing looks wrong until somebody clicks through to a 404 weeks
// later.
//
// ── AND WHY THE RECONCILER IS NOT OPTIONAL ─────────────────────────────────
// The projection is a second write of the same fact, so it can drift: a write
// path added later that forgets to call it, a migration that backfills rows
// directly, a bug fixed by hand in psql. `scripts/reproject.ts` re-derives every
// projection from the source tables and is the only thing that can find that.
//
// `bk super-admin entity-drift` is the platform's reconciler and it CANNOT do
// this job for you: it is bound to one deployment's app, because an app's
// Postgres role has no grant on another app's schema. Run against a database
// with 51 unprojected sales rows it reported no drift and exited 0 — CLAUDE.md
// finding #14. **Every app needs its own reproject script. This is it.**
import { and, eq, isNull } from 'drizzle-orm'
import type { PlatformDatabase } from '@blackcode/platform-db'
import {
  getEntityContext,
  purgeEntity,
  setEntityDeletedAt,
  upsertEntity,
  type Executor,
} from '@blackcode/platform-db'
import { notes } from '../schema'
import { APP_SLUG } from '../../app'

export type { Executor }

/**
 * The entity types this app projects. One, here — a real app has several, and
 * the union is what stops a typo becoming an unaddressable URN nobody notices.
 */
export type ScaffoldEntityType = 'note'

/**
 * Where a note lives in this app's UI. **The one app-specific fact in this
 * file**, and the reason the projection cannot live in a platform package.
 *
 * The path is joined to `platform.apps.base_url` by `upsertEntity`, which is why
 * that column is load-bearing (D-1) and why a stale value sends every cross-app
 * link to the wrong host.
 */
function entityPath(workspaceSlug: string, type: ScaffoldEntityType, n: number): string {
  return `/dashboard/${workspaceSlug}/${type}s/${n}`
}

export interface ProjectEntityInput {
  workspaceId: number
  entityType: ScaffoldEntityType
  /** The workspace #number (`seq`), never the row id. */
  number: number | null | undefined
  title: string
  deletedAt?: Date | null
}

/**
 * Mirror one row into `platform.entities`. Idempotent.
 *
 * Returns the URN, or null when the row cannot be addressed. **Never throws:**
 * the projection must not be able to fail the write it is projecting. An
 * unaddressable row loses its projection and the reconciler reports it as
 * missing, which is a problem somebody can see and fix — unlike a create that
 * started failing for a reason nobody connects to search.
 */
export async function projectEntity(
  tx: Executor,
  input: ProjectEntityInput
): Promise<string | null> {
  if (input.number == null) return null
  const ctx = await getEntityContext(tx, APP_SLUG, input.workspaceId)
  if (!ctx) return null
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
 * Mirror a soft delete, or a restore with `deletedAt: null`.
 *
 * The projection row STAYS either way — only a purge removes it. A link into the
 * recycle bin has to survive, because restoring the item has to bring its links
 * back with it.
 */
export async function markEntityDeleted(
  tx: Executor,
  args: { workspaceId: number; entityType: ScaffoldEntityType; number: number; deletedAt: Date | null }
): Promise<void> {
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

/** Remove the projection. Only on a PURGE — the row is gone for good. */
export async function purgeProjectedEntity(
  tx: Executor,
  args: { workspaceId: number; entityType: ScaffoldEntityType; number: number }
): Promise<void> {
  await purgeEntity(tx, {
    app: APP_SLUG,
    workspaceId: args.workspaceId,
    entityType: args.entityType,
    number: args.number,
  })
}

/** One source row, in the shape the reconciler compares against. */
export interface SourceRow {
  entityType: ScaffoldEntityType
  number: number
  title: string
  deletedAt: Date | null
}

/**
 * Every projectable row in one workspace, read from the SOURCE tables.
 *
 * This is what `scripts/reproject.ts` re-derives the projection from. Add a new
 * entity type here in the same change that adds its table — a type missing from
 * this list is a type the reconciler silently never checks, which is the same
 * shape of failure as the reconciler not existing.
 */
export async function readSourceRows(
  db: PlatformDatabase<Record<string, unknown>>,
  workspaceId: number
): Promise<SourceRow[]> {
  const rows = await db
    .select({ seq: notes.seq, title: notes.title })
    .from(notes)
    .where(and(eq(notes.workspace_id, workspaceId), isNull(notes.deleted_at)))
  return rows.map((r) => ({
    entityType: 'note' as const,
    number: r.seq,
    title: r.title,
    deletedAt: null,
  }))
}
