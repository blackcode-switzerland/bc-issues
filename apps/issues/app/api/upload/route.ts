// GET/POST /api/upload — mounted from the shared factory.
//
// Class A. Every app that stores files needs this on its OWN origin, because
// `platform.uploads.app` and the `<app>/<workspace>/<file>` path prefix are both
// set by whoever serves the request. A sales document uploaded through this host
// would be an issues file forever.

import { uploadRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

// One line per method: `export const { GET } = …` serves identically and drops
// the route out of cli-parity's coverage. See routes/index.ts.
const handlers = uploadRoute(appContext)
export const GET = handlers.GET
export const POST = handlers.POST
