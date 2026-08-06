// POST /api/me/active-workspace — mounted from the shared factory.

import { activeWorkspaceRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const POST = activeWorkspaceRoute(appContext)
