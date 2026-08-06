// GET /api/users — mounted from the shared factory.
// The privacy guard (you only see people you share a workspace with) lives in
// the query's join. See packages/platform-api/src/routes/users.ts.

import { usersRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = usersRoute(appContext)
