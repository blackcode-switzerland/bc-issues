// This app's storage entry point. **Import storage from HERE, never from
// `@blackcode/platform-storage` directly.**
//
// Why the indirection: the platform's reference registry only knows about apps
// that have registered a scanner, and a delete path that ran before this app
// registered its own would be asking "does anything reference this file?" with
// half the answer available. Importing the package directly from a route is how
// that happens. Every reference and GC call therefore goes through this module,
// whose import side effect is the registration itself.
//
// The registry fails closed — an unregistered enabled app is an ERROR, not a
// "no references" — so the worst case is a refused delete rather than a lost
// file. This module is what keeps that from being a routine occurrence.
//
// The db client is resolved LAZILY, per call, so the pure helpers stay usable
// without a configured DATABASE_URL.

import {
  computeWorkspaceReferences as computeReferences,
  isUrlReferencedAnywhere as isReferenced,
  listAppSlugs,
  registerReferenceScanner,
  sweepOrphanedUrls as sweep,
  type Reference,
} from '@blackcode/platform-storage'
import { salesReferenceScanner } from './scanner'

registerReferenceScanner(salesReferenceScanner)

async function getDb() {
  return (await import('@/lib/db/client')).getDb()
}

export type { Reference }
export { removeBlobBytes } from '@blackcode/platform-storage'
export { extractUploadedUrls, isUploadedAsset } from '@blackcode/platform-storage'
export { salesReferenceScanner, SURFACES, INDEX_APP_BY_TYPE, RETRIGGER_SQL } from './scanner'

/** url → what references it, for one workspace, across every registered app. */
export async function computeWorkspaceReferences(
  workspaceId: number
): Promise<Map<string, Reference[]>> {
  return computeReferences(await getDb(), workspaceId)
}

/** The delete-time gate. Throws rather than answering false when unprovable. */
export async function isUrlReferencedAnywhere(url: string): Promise<boolean> {
  return isReferenced(await getDb(), url)
}

/** Delete the bytes behind each url that no app references any more. */
export async function sweepOrphanedUrls(urls: Array<string | null | undefined>): Promise<void> {
  return sweep(await getDb(), urls)
}

/**
 * Every app slug in `platform.apps`, enabled or not — the input to the upload
 * handshake's "is this path someone else's?" check.
 */
export async function knownAppSlugs(): Promise<string[]> {
  return listAppSlugs(await getDb())
}
