// POST /api/errors/client — mounted from the shared factory.

import { clientErrorsRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const POST = clientErrorsRoute(appContext)
