// Cross-workspace entity location + seq resolution.
//
// Every work item now has two identifiers:
//   - `id`   — global serial PK, backend-only (FKs, sub-resource lookups)
//   - `seq`  — workspace-scoped #number shown in the UI and URL
//
// URLs are /dashboard/{ws}/{type}/{seq}. The detail page resolves (ws, seq) →
// id via resolveSeqToId. Old /dashboard/{type}/{id} links resolve the other
// way (id → ws + seq) via locateEntity and 301 to the canonical URL.

import { sql } from 'drizzle-orm'
import { db } from '../client'

export type LocatableType = 'issue' | 'task' | 'project'

export interface EntityLocation {
  workspace_id: number
  seq: number | null
}

// id (global) → { workspace_id, seq }. null if missing / in the recycle bin.
// Membership is NOT checked here — the caller gates via getWorkspaceForUser.
export async function locateEntity(
  type: LocatableType,
  id: number
): Promise<EntityLocation | null> {
  const query =
    type === 'issue'
      ? sql`SELECT workspace_id, seq FROM issues WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`
      : type === 'task'
        ? sql`SELECT workspace_id, seq FROM tasks WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`
        : sql`SELECT workspace_id, seq FROM projects WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`
  const result = await db.execute(query)
  const row = result.rows[0] as unknown as EntityLocation | undefined
  return row ?? null
}

// (workspace, seq) → global id. null if no such #number in the workspace.
export async function resolveSeqToId(
  workspaceId: number,
  type: LocatableType,
  seq: number
): Promise<number | null> {
  const query =
    type === 'issue'
      ? sql`SELECT id FROM issues WHERE workspace_id = ${workspaceId} AND seq = ${seq} AND deleted_at IS NULL LIMIT 1`
      : type === 'task'
        ? sql`SELECT id FROM tasks WHERE workspace_id = ${workspaceId} AND seq = ${seq} AND deleted_at IS NULL LIMIT 1`
        : sql`SELECT id FROM projects WHERE workspace_id = ${workspaceId} AND seq = ${seq} AND deleted_at IS NULL LIMIT 1`
  const result = await db.execute(query)
  const row = result.rows[0] as { id: number } | undefined
  return row?.id ?? null
}
