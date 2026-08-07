// GET|POST /api/workspaces/{ws}/apps/{app}/access — `bk app access list | grant`.
import { workspaceAppAccessRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = workspaceAppAccessRoute(appContext)
export const GET = handlers.GET
export const POST = handlers.POST
