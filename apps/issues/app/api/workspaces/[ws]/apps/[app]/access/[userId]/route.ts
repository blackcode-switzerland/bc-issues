// DELETE /api/workspaces/{ws}/apps/{app}/access/{userId} — mounted from the
// shared factory. Class A, owner only.

import { workspaceAppAccessMemberRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = workspaceAppAccessMemberRoute(appContext)
export const DELETE = handlers.DELETE
