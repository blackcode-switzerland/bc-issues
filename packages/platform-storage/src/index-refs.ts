// Reading `platform.blob_references` — the index a deployment consults for the
// apps it cannot scan.
//
// NOTHING HERE WRITES. The index is maintained exclusively by the Postgres
// triggers migration 0037 installs, and app roles hold SELECT on the table and
// nothing more (docs/sql/app-role.sql). If you find yourself wanting an
// `insertBlobReference()` here, stop: an application writer is precisely the
// failure mode the trigger design exists to remove, and adding one back would
// reintroduce "a write path forgot" as a way to lose a file. Add a trigger to
// the new content column instead.
//
// Read `packages/platform-db/src/schema.ts` at `blobReferences` for the why.

import { sql } from 'drizzle-orm'
import { blobReferences } from '@blackcode/platform-db/schema'
import type { Executor, Reference } from './references'

// `sql.param(arr)::text[]` — NOT a bare `${arr}`. Drizzle expands a plain
// interpolated array into a comma-separated LIST of parameters, so
// `app = ANY (${apps})` compiles to `ANY (($1, $2))`, a row constructor, and the
// query fails at the database rather than at review. Wrapping it in
// `sql.param()` sends one array parameter, and the cast tells Postgres its type.
const textArray = (values: readonly string[]) => sql`${sql.param([...values])}::text[]`

/**
 * The pseudo-app the index attributes references held by PLATFORM-owned content
 * to — today `platform.comments`, which every app writes into and which
 * therefore belongs to none of them.
 *
 * It is always consulted, by every deployment, regardless of which scanners are
 * registered: no app can claim those rows, so no app's scanner can be trusted to
 * account for them.
 */
export const PLATFORM_REF_APP = 'platform'

/**
 * Does any of `apps` hold an indexed reference to `url`?
 *
 * `PLATFORM_REF_APP` is added to whatever the caller passes. An empty `apps`
 * therefore still checks platform-owned content rather than returning a blanket
 * `false`.
 */
export async function isUrlReferencedByIndex(
  db: Executor,
  url: string,
  apps: readonly string[]
): Promise<boolean> {
  const wanted = [...new Set([...apps, PLATFORM_REF_APP])]
  const res = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM ${blobReferences}
      WHERE url = ${url} AND app = ANY (${textArray(wanted)})
    ) AS referenced
  `)
  return Boolean((res.rows[0] as { referenced?: unknown } | undefined)?.referenced)
}

/**
 * Indexed references in one workspace, held by `apps` (plus platform-owned
 * content), as `url → Reference[]`.
 *
 * The `Reference` these produce carries no `label`: the index deliberately
 * stores no title, because a title is another app's data that would go stale the
 * moment that app renamed the row. The Storage page shows "referenced by sales
 * (issue #12)" rather than the title, which is the honest amount of detail a
 * deployment that cannot read `sales.*` is entitled to.
 */
export async function listIndexedWorkspaceReferences(
  db: Executor,
  workspaceId: number,
  apps: readonly string[]
): Promise<Map<string, Reference[]>> {
  const wanted = [...new Set([...apps, PLATFORM_REF_APP])]
  const res = await db.execute(sql`
    SELECT url, app, source_type, source_id
    FROM ${blobReferences}
    WHERE workspace_id = ${workspaceId} AND app = ANY (${textArray(wanted)})
    ORDER BY app, source_type, source_id
  `)
  const map = new Map<string, Reference[]>()
  for (const row of res.rows as Record<string, unknown>[]) {
    const url = String(row.url)
    const list = map.get(url) ?? []
    list.push({
      app: String(row.app),
      type: String(row.source_type),
      id: Number(row.source_id),
      seq: null,
      label: null,
      // The index does not record soft-delete state, and must not: a binned item
      // is restorable, so its files are still in use either way. `false` here
      // means "not known to be trashed", which is the safe reading.
      trashed: false,
    })
    map.set(url, list)
  }
  return map
}

/** One indexed row, as the drift reconciler compares them. */
export interface IndexedReferenceRow {
  url: string
  app: string
  source_type: string
  source_id: number
  workspace_id: number | null
}

/**
 * Every indexed row for a workspace, unfiltered by app — the reconciler's side
 * of the comparison against a live scan.
 */
export async function listIndexedReferenceRows(
  db: Executor,
  workspaceId: number
): Promise<IndexedReferenceRow[]> {
  const res = await db.execute(sql`
    SELECT url, app, source_type, source_id, workspace_id
    FROM ${blobReferences}
    WHERE workspace_id = ${workspaceId}
    ORDER BY app, source_type, source_id, url
  `)
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    url: String(r.url),
    app: String(r.app),
    source_type: String(r.source_type),
    source_id: Number(r.source_id),
    workspace_id: r.workspace_id == null ? null : Number(r.workspace_id),
  }))
}
