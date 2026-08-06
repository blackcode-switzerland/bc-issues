// GET /api/workspaces/{ws}/members — mounted from the shared factory.

import { workspaceMembersRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = workspaceMembersRoute(appContext)
