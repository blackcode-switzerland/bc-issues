// GET /api/workspaces/{ws}/apps — `bk app list`.
//
// Which apps exist, which are enabled, and where each one lives. `bk` learns
// every app's server address from here (D-1), so an app that does not serve it
// leaves a user homed on this deployment unable to reach any OTHER app.
import { workspaceAppsRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = workspaceAppsRoute(appContext)
