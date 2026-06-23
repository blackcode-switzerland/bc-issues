// Query helpers for the upload ledger (see schema.ts `uploads`).
//
// The ledger records every file stored through our pipeline. It is metadata
// only — it never decides whether a file may be deleted (that is a live
// reference scan, lib/blob-refs.ts). recordUpload is idempotent on `url`, so the
// various upload paths can call it freely without worrying about duplicates.

import { eq, sql } from 'drizzle-orm'
import { db } from '../client'
import { uploads } from '../schema'
import type { Upload } from '../schema'

export async function recordUpload(data: {
  url: string
  pathname?: string | null
  filename: string
  size?: number | null
  mime_type?: string | null
  workspace_id?: number | null
  uploaded_by?: number | null
}): Promise<void> {
  // ON CONFLICT (url) DO NOTHING — re-recording the same upload is a no-op, and a
  // ledger write must never break an upload, so failures are swallowed by the
  // caller. We keep this query minimal and dependency-light on purpose.
  await db
    .insert(uploads)
    .values({
      url: data.url,
      pathname: data.pathname ?? null,
      filename: data.filename,
      size: data.size ?? null,
      mime_type: data.mime_type ?? null,
      workspace_id: data.workspace_id ?? null,
      uploaded_by: data.uploaded_by ?? null,
    })
    .onConflictDoNothing({ target: uploads.url })
}

// All ledger rows for a workspace, with uploader name, newest first.
export async function listWorkspaceUploads(workspaceId: number): Promise<
  Array<Upload & { uploader_name: string | null; uploader_avatar: string | null }>
> {
  const res = await db.execute(sql`
    SELECT u.*, usr.name AS uploader_name, usr.avatar_url AS uploader_avatar
    FROM uploads u
    LEFT JOIN users usr ON usr.id = u.uploaded_by
    WHERE u.workspace_id = ${workspaceId}
    ORDER BY u.created_at DESC
  `)
  return res.rows as Array<Upload & { uploader_name: string | null; uploader_avatar: string | null }>
}

export async function getUpload(id: number): Promise<Upload | null> {
  const rows = await db.select().from(uploads).where(eq(uploads.id, id)).limit(1)
  return rows[0] ?? null
}

export async function deleteUploadRow(id: number): Promise<void> {
  await db.delete(uploads).where(eq(uploads.id, id))
}

// Remove the ledger row for a url (used by automatic GC after the bytes are
// deleted). No-op if the url was never recorded.
export async function deleteUploadByUrl(url: string): Promise<void> {
  await db.delete(uploads).where(eq(uploads.url, url))
}

// Total bytes currently recorded for a workspace — the basis for future storage
// quotas (compared against workspaces.storage_limit_bytes). NULL sizes count 0.
export async function computeWorkspaceStorageUsage(workspaceId: number): Promise<number> {
  const res = await db.execute(sql`
    SELECT COALESCE(SUM(size), 0)::bigint AS used FROM uploads WHERE workspace_id = ${workspaceId}
  `)
  return Number((res.rows[0] as { used: string | number })?.used ?? 0)
}
