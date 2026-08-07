// DELETE /api/workspaces/{ws}/members/{userId} — `bk member remove`.
import { workspaceMemberRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = workspaceMemberRoute(appContext)
export const DELETE = handlers.DELETE
