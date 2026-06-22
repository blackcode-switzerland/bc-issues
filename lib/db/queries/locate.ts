// seq → internal id resolution.
//
// Every work item has two identifiers: the global serial primary key (`id`,
// used only inside the DB for FKs/joins) and the workspace-scoped number
// (`seq`) which is the only id the API/CLI/URLs ever expose. Route handlers
// receive a seq and call this to get the internal id for the query layer.

import { sql } from 'drizzle-orm'
import { db } from '../client'

export type LocatableType = 'issue' | 'task' | 'project'

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
