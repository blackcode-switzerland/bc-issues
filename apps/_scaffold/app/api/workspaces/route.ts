// GET /api/workspaces — the workspaces this caller can use IN THIS APP.
//
// App-scoped: the listing filters on `platform.app_access` when
// PLATFORM_ENFORCE_APP_ACCESS is on. Membership of a workspace is not permission
// to use every app in it.
import { workspacesRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = workspacesRoute(appContext)
