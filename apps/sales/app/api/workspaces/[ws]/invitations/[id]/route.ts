// DELETE /api/workspaces/{ws}/invitations/{id} — `bk invite revoke`.
import { workspaceInvitationRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const DELETE = workspaceInvitationRoute(appContext)
