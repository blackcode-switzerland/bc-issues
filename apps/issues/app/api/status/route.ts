// GET /api/status — mounted from the shared factory.
//
// Every deployment serves its own: a probe answered by a different deployment
// says that one is up, which is not the question a monitor is asking.
//
// `/api/status/errors` and `/api/status/errors/{id}` are NOT factories — they
// feed the public /status page, which is a per-app product decision rather than
// part of being monitorable. They stay in this app's tree.

import { statusRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = statusRoute(appContext)
