// Automatic blob garbage collection for terminal delete events.
//
// When content that may embed uploaded files is permanently removed — a comment
// hard-deleted, an item purged from the recycle bin — the files it referenced
// can become orphans. This module deletes those orphans automatically, but only
// after a live, system-wide reference check: a file is removed ONLY if nothing
// else (in any workspace, including trashed items) still points at it. This is
// the same safety gate the owner-facing Storage delete uses, so automatic
// cleanup can never destroy a file something still needs.
//
// Always best-effort: every removal is independently guarded, and failures are
// logged, never thrown — a storage hiccup must not fail the user's delete.

import { del } from '@vercel/blob'
import { rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { isUrlReferencedAnywhere } from './blob-refs'
import { deleteUploadByUrl } from './db/queries/uploads'

// Remove the underlying bytes: Vercel Blob in prod (del by URL), or a local file
// under public/uploads in dev. Shared with the owner-facing Storage delete route.
export async function removeBlobBytes(url: string): Promise<void> {
  if (url.startsWith('/uploads/')) {
    const uploadsDir = resolve(process.cwd(), 'public/uploads')
    const dest = resolve(uploadsDir, url.slice('/uploads/'.length))
    // Defense-in-depth: never let a crafted path escape the uploads dir.
    if (!dest.startsWith(uploadsDir + sep)) throw new Error('refusing to delete outside uploads dir')
    await rm(dest, { force: true })
    return
  }
  await del(url)
}

// Delete each url whose live reference count is now zero. Call AFTER the rows
// that referenced the files have been removed, so the scan reflects the new
// state. Safe to pass urls that are still referenced (they're skipped) or that
// were never ours / already gone (best-effort).
export async function sweepOrphanedUrls(urls: Array<string | null | undefined>): Promise<void> {
  const unique = [...new Set(urls.filter((u): u is string => Boolean(u)))]
  for (const url of unique) {
    try {
      if (await isUrlReferencedAnywhere(url)) continue // still in use → keep
      await removeBlobBytes(url)
      await deleteUploadByUrl(url)
    } catch (err) {
      console.error('[blob-gc] failed to sweep orphan (non-fatal):', url, err)
    }
  }
}
