// GET /api/workspaces/{ws}/apps — mounted from the shared factory.
// Readable by any member; every mutation under [app]/ is owner-only and stays
// in this app's tree until the event spine is shared.

import { workspaceAppsRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = workspaceAppsRoute(appContext)
