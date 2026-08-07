// DELETE /api/workspaces/{ws}/apps/{app}/access/{userId} — `bk app access revoke`.
import { workspaceAppAccessMemberRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = workspaceAppAccessMemberRoute(appContext)
export const DELETE = handlers.DELETE
