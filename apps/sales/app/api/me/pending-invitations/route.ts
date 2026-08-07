// GET /api/me/pending-invitations — `bk invite pending`. Per-user, cross-workspace.
import { pendingInvitationsRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = pendingInvitationsRoute(appContext)
