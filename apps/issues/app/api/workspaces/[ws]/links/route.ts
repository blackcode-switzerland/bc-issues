// /api/workspaces/{ws}/links — mounted from the shared factory.
//
// Named exports assigned one at a time, never `export const { GET } = …`: the
// parity guard matches /export\s+(const|function)\s+GET\b/, so a destructuring
// export would serve fine while vanishing from the coverage check.

import { linksRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = linksRoute(appContext)

export const GET = handlers.GET
export const POST = handlers.POST
export const DELETE = handlers.DELETE
