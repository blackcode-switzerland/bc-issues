// The upload ledger — `platform.uploads`.
//
// One row per file stored through our pipeline, recording where it lives, who
// put it there, which workspace it belongs to and, since Phase 7, which APP
// wrote it. It is the source for the owner-facing Storage page and for
// `bk storage list`.
//
// IMPORTANT: the ledger is metadata only. It is NEVER the authority for whether
// a file may be deleted — that is a live reference scan (references.ts) — so a
// stale or missing ledger row can never cause data loss. `url` is unique, so
// recording the same upload twice is a no-op and every upload path may call
// `recordUpload` freely.
//
// Raw SQL throughout, interpolating the Drizzle table objects so every statement
// stays schema-qualified, and so each helper can take either a `db` or a
// transaction handle — the same `Executor` shape as `platform-db`'s helpers.

import { sql } from 'drizzle-orm'
import { uploads, users } from '@blackcode/platform-db/schema'
import type { Upload } from '@blackcode/platform-db/schema'
import type { Executor } from './references'

export type UploadRow = Upload & {
  uploader_name: string | null
  uploader_avatar: string | null
}

export async function recordUpload(
  db: Executor,
  data: {
    url: string
    pathname?: string | null
    filename: string
    size?: number | null
    mime_type?: string | null
    workspace_id?: number | null
    uploaded_by?: number | null
    /** The app that wrote the file — `platform.apps.slug`. */
    app?: string | null
  }
): Promise<void> {
  await db.execute(sql`
    INSERT INTO ${uploads} (url, pathname, filename, size, mime_type, workspace_id, uploaded_by, app)
    VALUES (
      ${data.url},
      ${data.pathname ?? null},
      ${data.filename},
      ${data.size ?? null},
      ${data.mime_type ?? null},
      ${data.workspace_id ?? null},
      ${data.uploaded_by ?? null},
      ${data.app ?? null}
    )
    ON CONFLICT (url) DO NOTHING
  `)
}

/**
 * All ledger rows for a workspace, with uploader name, newest first.
 *
 * `app` filters to one app's files. It is a filter on the LEDGER, not on the
 * path: files uploaded before Phase 7 sit flat at the store root and are
 * attributed by the backfilled column, not by where they are.
 */
export async function listWorkspaceUploads(
  db: Executor,
  workspaceId: number,
  opts: { app?: string | null } = {}
): Promise<UploadRow[]> {
  const appFilter = opts.app ? sql`AND u.app = ${opts.app}` : sql``
  const res = await db.execute(sql`
    SELECT u.*, usr.name AS uploader_name, usr.avatar_url AS uploader_avatar
    FROM ${uploads} u
    LEFT JOIN ${users} usr ON usr.id = u.uploaded_by
    WHERE u.workspace_id = ${workspaceId}
    ${appFilter}
    ORDER BY u.created_at DESC
  `)
  return res.rows as UploadRow[]
}

export async function getUpload(db: Executor, id: number): Promise<Upload | null> {
  const res = await db.execute(sql`SELECT * FROM ${uploads} WHERE id = ${id} LIMIT 1`)
  return (res.rows[0] as Upload | undefined) ?? null
}

export async function deleteUploadRow(db: Executor, id: number): Promise<void> {
  await db.execute(sql`DELETE FROM ${uploads} WHERE id = ${id}`)
}

/**
 * Remove the ledger row for a url (used by GC after the bytes are deleted).
 * No-op if the url was never recorded.
 */
export async function deleteUploadByUrl(db: Executor, url: string): Promise<void> {
  await db.execute(sql`DELETE FROM ${uploads} WHERE url = ${url}`)
}

/**
 * Total bytes recorded for a workspace — the basis for storage quotas (compared
 * against `workspaces.storage_limit_bytes`). NULL sizes count 0. Counts every
 * app's files: the quota is the workspace's, not one app's.
 */
export async function computeWorkspaceStorageUsage(
  db: Executor,
  workspaceId: number
): Promise<number> {
  const res = await db.execute(sql`
    SELECT COALESCE(SUM(size), 0)::bigint AS used FROM ${uploads} WHERE workspace_id = ${workspaceId}
  `)
  return Number((res.rows[0] as { used: string | number } | undefined)?.used ?? 0)
}
