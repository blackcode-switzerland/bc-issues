// DELETE /api/tokens/{id} — mounted from the shared factory.
// Session-only, same rationale and same mount-time enforcement as /api/tokens.

import { tokenRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = tokenRoute(appContext)

export const DELETE = handlers.DELETE
