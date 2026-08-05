// Blob garbage collection — the only code in the platform that destroys bytes.
//
// This runs on USER ACTION, not on a schedule: when content that may embed
// uploaded files is permanently removed (a comment hard-deleted, an item purged
// from the recycle bin), the files it referenced may have become orphans. There
// is no undo behind `del()`, no snapshot and no recycle bin for blobs, so every
// removal here is gated by a live, cross-app, cross-workspace reference check
// immediately beforehand — the same gate the owner-facing Storage delete uses.
//
// Two invariants, both deliberate:
//
//   - A reference answer that could not be computed is a REFUSAL. Coverage
//     errors and scanner failures come out of `isUrlReferencedAnywhere` as
//     rejections; the catch below logs and moves on WITHOUT deleting. Best-effort
//     applies to finishing the sweep, never to the safety check.
//   - Bytes first, ledger second. If the storage delete fails, the ledger row
//     stays, so the file remains visible on the Storage page and the delete
//     stays retryable. The reverse order would lose the file silently.

import { del } from '@vercel/blob'
import { rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { isUrlReferencedAnywhere, type Executor } from './references'
import { deleteUploadByUrl } from './uploads'

/**
 * Remove the underlying bytes: Vercel Blob in production (del by URL), or a
 * local file under `public/uploads` in dev.
 *
 * This does NOT check references — callers must. The owner-facing delete route
 * and `sweepOrphanedUrls` both gate on `isUrlReferencedAnywhere` first.
 */
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

/**
 * Delete each url whose live reference count is now zero.
 *
 * Call AFTER the rows that referenced the files are gone, so the scan sees the
 * new state. Safe to pass urls that are still referenced (skipped), that were
 * never ours, or that are already deleted.
 *
 * Never throws: a storage hiccup must not fail the user's delete. A failure to
 * *decide* is logged and the file is kept.
 */
export async function sweepOrphanedUrls(
  db: Executor,
  urls: Array<string | null | undefined>
): Promise<void> {
  const unique = [...new Set(urls.filter((u): u is string => Boolean(u)))]
  for (const url of unique) {
    try {
      if (await isUrlReferencedAnywhere(db, url)) continue // still in use → keep
      await removeBlobBytes(url)
      await deleteUploadByUrl(db, url)
    } catch (err) {
      // Includes ReferenceCoverageError and any scanner failure: we could not
      // establish that the file is an orphan, so it stays.
      console.error('[blob-gc] failed to sweep orphan (non-fatal, file kept):', url, err)
    }
  }
}
