// GET/POST /api/workspaces/{ws}/apps/{app}/access — mounted from the shared factory.
//
// Class A. GET is readable by any member — "why can Ana see this and I can't"
// should be answerable without asking an owner. POST is owner only.

import { workspaceAppAccessRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = workspaceAppAccessRoute(appContext)
export const GET = handlers.GET
export const POST = handlers.POST
