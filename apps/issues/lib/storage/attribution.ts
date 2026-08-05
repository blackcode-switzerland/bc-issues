// Which workspace does an upload belong to?
//
// Both upload paths — the multipart route and the client-direct Blob handshake —
// need the same answer, and since Phase 7 they need it as a SLUG as well as an
// id: the id goes in the ledger, the slug goes in the blob pathname
// (`issues/<workspace>/<file>`).
//
// Attribution is best-effort and never throws. An upload is not rejected for
// being unattributable — `platform.uploads.workspace_id` is nullable for exactly
// that reason — it just lands under the `unattributed` prefix and shows up in no
// workspace's Storage page until someone attributes it.

import { getWorkspaceById, getWorkspaceForUser } from '@/lib/db/queries/workspaces'
import type { User } from '@/lib/db/schema'

export interface UploadAttribution {
  id: number | null
  slug: string | null
}

/**
 * Resolve the target workspace: an explicit slug/id the caller passed (checked
 * against their membership), else their active workspace.
 */
export async function attributeUpload(
  user: User,
  explicit?: string | null
): Promise<UploadAttribution> {
  if (explicit) {
    try {
      const ws = await getWorkspaceForUser(explicit, user.id)
      if (ws) return { id: ws.id, slug: ws.slug }
    } catch {
      /* fall through to the active workspace */
    }
  }
  if (user.active_workspace_id) {
    try {
      const ws = await getWorkspaceById(user.active_workspace_id)
      if (ws) return { id: ws.id, slug: ws.slug }
    } catch {
      /* fall through */
    }
    return { id: user.active_workspace_id, slug: null }
  }
  return { id: null, slug: null }
}
