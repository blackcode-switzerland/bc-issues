// GET /api/changelog — mounted from the shared factory.
//
// The feed is the same on every app's origin: it merges docs/changelog/*.md, the
// whole repo's record. An agent should not have to know how many apps exist, or
// pick a host, to find out what changed.

import { changelogRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = changelogRoute(appContext)
