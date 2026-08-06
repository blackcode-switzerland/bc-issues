// DELETE /api/workspaces/{ws}/members/{userId} — mounted from the shared factory.
//
// Class A. Membership is platform: one workspace, every app. It could not be
// shared until D-23 cut the event seam, because removing a member records one.

import { workspaceMemberRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = workspaceMemberRoute(appContext)
export const DELETE = handlers.DELETE
