// GET /api/workspaces/{ws}/invite-candidates — mounted from the shared factory.
// Owner-only, the same gate as POST /invitations.

import { inviteCandidatesRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = inviteCandidatesRoute(appContext)
