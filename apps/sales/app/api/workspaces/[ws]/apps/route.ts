// GET /api/workspaces/{ws}/apps — `bk app list`.
//
// The SECOND command of the north-star script, and it 404'd from this host.
// The irony was total: the command that tells you which apps exist and which
// server each is on was unreachable from one of them.
import { workspaceAppsRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = workspaceAppsRoute(appContext)
