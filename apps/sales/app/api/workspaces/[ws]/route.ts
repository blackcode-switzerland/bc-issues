// GET /api/workspaces/{ws} — `bk workspace show`, and what `bk workspace use`
// resolves a slug against before saving it.
//
// **PATCH and DELETE are deliberately absent.** Renaming a workspace or deleting
// one is company-level administration: `updateWorkspace` and `deleteWorkspace`
// are still app-local to issues, and a workspace delete carries a cascade that
// has exactly one implementation on purpose. Sales reads the workspace it is
// working in; it does not administer it. `bk workspace edit | delete | transfer`
// are answered by the issues deployment, and reaching them from here now says so
// with the app named and the flag to use.
import { workspaceShowRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = workspaceShowRoute(appContext)
