import { getValidatedSessionUser } from '@/lib/auth/session'
import { listMyWorkspaces } from '@/lib/db/queries/workspaces'
import { APP_SLUG } from '@/lib/app'

// Slug of the user's remembered (active) workspace, or their first one.
// Used by the bare /dashboard and legacy redirects to land somewhere sensible.
// Returns null if the user has no session or no workspaces.
//
// App-scoped on purpose: "somewhere sensible" means a workspace this app can
// actually be used in. Landing someone on a workspace they hold membership in but
// no access to would show them a 403 page they cannot act on.
export async function getDefaultWorkspaceSlug(): Promise<string | null> {
  const user = await getValidatedSessionUser()
  if (!user) return null
  const workspaces = await listMyWorkspaces(user.id, { app: APP_SLUG })
  if (workspaces.length === 0) return null
  const active = workspaces.find((w) => w.id === user.active_workspace_id) ?? workspaces[0]
  return active.slug
}
