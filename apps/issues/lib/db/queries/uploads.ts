// This app's binding to the shared upload ledger — the READ half.
//
// The queries themselves moved to `@blackcode/platform-storage` in Phase 7 —
// `platform.uploads` is a platform table and a second app would need exactly
// these statements unchanged.
//
// ── THERE IS NO `recordUpload` HERE ANY MORE, AND THAT IS THE POINT ──────────
// This file used to carry one, whose whole job was stamping `APP_SLUG` so that
// no upload path had to remember to. On 2026-08-06 `/api/upload` and
// `/api/upload/blob` became shared factories that stamp `AppContext.appSlug`
// instead (docs/sales-app-plan.md Phase 1b-C), and the binding was deleted
// rather than left sitting there.
//
// Deleted deliberately: `platform.uploads.app` and the `<app>/…` path prefix are
// how a file is attributed FOREVER — nothing moves a blob afterwards — so a
// second way to write a ledger row is a second thing that can attribute one
// wrongly. A new write path takes the factory, or supplies the slug the way the
// factory does.
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
  type UploadRow,
} from '@blackcode/platform-storage'
import type { Upload } from '../schema'

export type { UploadRow }

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
