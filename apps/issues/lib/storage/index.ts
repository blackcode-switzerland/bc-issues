// This app's storage entry point. Import storage from HERE, never from
// `@blackcode/platform-storage` directly.
//
// Why the indirection: the platform's reference registry only knows about apps
// that have registered a scanner, and a delete path that runs before this app
// registered its own would be asking "does anything reference this file?" with
// half the answer available. Importing the package directly from a route is how
// that happens. Every reference and GC call therefore goes through this module,
// whose import side effect is the registration itself.
//
// (The registry fails closed — an unregistered enabled app is an error, not a
// "no references" — so the worst case is a refused delete rather than a lost
// file. This module is what keeps that from being a routine occurrence.)
//
// The db client is resolved LAZILY, per call. `lib/blob-refs.ts` did the same
// before Phase 7 so the pure helpers stay usable without a configured
// DATABASE_URL — which is what lets the extraction unit tests run at all.

import {
  computeWorkspaceReferences as computeReferences,
  isUrlReferencedAnywhere as isReferenced,
  registerReferenceScanner,
  sweepOrphanedUrls as sweep,
  type Reference,
} from '@blackcode/platform-storage'
import { issuesReferenceScanner } from './scanner'

registerReferenceScanner(issuesReferenceScanner)

async function getDb() {
  return (await import('@/lib/db/client')).db
}

export type { Reference }
export { removeBlobBytes } from '@blackcode/platform-storage'
export { extractUploadedUrls, isUploadedAsset } from '@blackcode/platform-storage'

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
