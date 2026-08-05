// This app's binding to the shared upload ledger.
//
// The queries themselves moved to `@blackcode/platform-storage` in Phase 7 —
// `platform.uploads` is a platform table and a second app would need exactly
// these statements unchanged. What stays here is the one thing the platform
// cannot supply: which app is writing. `recordUpload` stamps `APP_SLUG` so no
// upload path has to remember to, and forgetting is not representable.
//
// The ledger is still metadata only. It never decides whether a file may be
// deleted — that is a live reference scan (lib/storage) — so a stale or missing
// row here can never cause data loss.

import { db } from '../client'
import {
  computeWorkspaceStorageUsage as computeUsage,
  deleteUploadByUrl as deleteByUrl,
  deleteUploadRow as deleteRow,
  getUpload as get,
  listWorkspaceUploads as list,
  recordUpload as record,
  type UploadRow,
} from '@blackcode/platform-storage'
import type { Upload } from '../schema'
import { APP_SLUG } from '@/lib/app'

export type { UploadRow }

export async function recordUpload(data: {
  url: string
  pathname?: string | null
  filename: string
  size?: number | null
  mime_type?: string | null
  workspace_id?: number | null
  uploaded_by?: number | null
}): Promise<void> {
  return record(db, { ...data, app: APP_SLUG })
}

export async function listWorkspaceUploads(
  workspaceId: number,
  opts: { app?: string | null } = {}
): Promise<UploadRow[]> {
  return list(db, workspaceId, opts)
}

export async function getUpload(id: number): Promise<Upload | null> {
  return get(db, id) as Promise<Upload | null>
}

export async function deleteUploadRow(id: number): Promise<void> {
  return deleteRow(db, id)
}

export async function deleteUploadByUrl(url: string): Promise<void> {
  return deleteByUrl(db, url)
}

export async function computeWorkspaceStorageUsage(workspaceId: number): Promise<number> {
  return computeUsage(db, workspaceId)
}
