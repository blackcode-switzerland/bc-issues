// GET /api/workspaces/{ws}/invite-candidates — `bk invite candidates`.
import { inviteCandidatesRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = inviteCandidatesRoute(appContext)
