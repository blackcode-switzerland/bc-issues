import { redirect } from 'next/navigation'

// Workspace settings moved out of the Settings tabs into a dedicated
// /dashboard/workspaces page (with a per-workspace manage subpage). Keep this
// route as a redirect so old links/bookmarks still resolve.
export default function WorkspaceSettingsRedirect() {
  redirect('/dashboard/workspaces')
}
