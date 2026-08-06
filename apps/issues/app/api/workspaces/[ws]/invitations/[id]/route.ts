// DELETE /api/workspaces/{ws}/invitations/{id} — mounted from the shared factory.
//
// Class A. Revoking an invitation records an event, which is why it waited for
// the D-23 seam.

import { workspaceInvitationRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = workspaceInvitationRoute(appContext)
export const DELETE = handlers.DELETE
