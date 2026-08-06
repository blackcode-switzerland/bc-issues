// GET /api/me/pending-invitations — mounted from the shared factory.

import { pendingInvitationsRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = pendingInvitationsRoute(appContext)
