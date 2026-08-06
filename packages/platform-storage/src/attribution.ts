// Which workspace does an upload belong to?
//
// Both upload paths need the same answer, and since Phase 7 they need it as a
// SLUG as well as an id: the id goes in the ledger, the slug goes in the blob
// pathname (`<app>/<workspace>/<file>`).
//
// Attribution is best-effort and NEVER THROWS. An upload is not rejected for
// being unattributable — `platform.uploads.workspace_id` is nullable for exactly
// that reason — it lands under the `unattributed` prefix and shows up in no
// workspace's Storage page until somebody attributes it. Every lookup below is
// wrapped for that reason and not out of caution: a workspace lookup failing
// must cost a file its folder, never its bytes.
//
// Moved from `apps/issues/lib/storage/attribution.ts` on 2026-08-06 with
// `/api/upload` (docs/sales-app-plan.md Phase 1b-C). It reads `platform.
// workspaces` and `platform.workspace_members` and nothing else — there was
// never anything about an issue tracker in it.

import {
  getWorkspaceById,
  getWorkspaceForUser,
  type PlatformDb,
  type User,
} from '@blackcode/platform-db'

export interface UploadAttribution {
  id: number | null
  slug: string | null
}

/**
 * Resolve the target workspace: an explicit slug/id the caller passed (checked
 * against their membership), else their active workspace.
 */
export async function attributeUpload(
  db: PlatformDb,
  user: User,
  explicit?: string | null
): Promise<UploadAttribution> {
  if (explicit) {
    try {
      const ws = await getWorkspaceForUser(db, explicit, user.id)
      if (ws) return { id: ws.id, slug: ws.slug }
    } catch {
      /* fall through to the active workspace */
    }
  }
  if (user.active_workspace_id) {
    try {
      const ws = await getWorkspaceById(db, user.active_workspace_id)
      if (ws) return { id: ws.id, slug: ws.slug }
    } catch {
      /* fall through */
    }
    return { id: user.active_workspace_id, slug: null }
  }
  return { id: null, slug: null }
}
