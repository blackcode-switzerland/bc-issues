// Cross-workspace entity location.
//
// Issue / task / project ids are globally unique (serial PKs), so a shared deep
// link like /dashboard/issues/30 can be resolved to its owning workspace from
// the id alone — no workspace in the URL required. The API route then gates on
// membership before returning the slug.

import { sql } from 'drizzle-orm'
import { db } from '../client'

export type LocatableType = 'issue' | 'task' | 'project'

// Returns the workspace_id that owns the entity, or null if it doesn't exist
// (or is in the recycle bin). Membership is NOT checked here — the caller gates
// via getWorkspaceForUser so non-members get a 404 (no existence leak).
export async function locateEntityWorkspace(
  type: LocatableType,
  id: number
): Promise<number | null> {
  const query =
    type === 'issue'
      ? sql`SELECT workspace_id FROM issues WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`
      : type === 'task'
        ? sql`SELECT workspace_id FROM tasks WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`
        : sql`SELECT workspace_id FROM projects WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`
  const result = await db.execute(query)
  const row = result.rows[0] as { workspace_id: number | null } | undefined
  return row?.workspace_id ?? null
}
