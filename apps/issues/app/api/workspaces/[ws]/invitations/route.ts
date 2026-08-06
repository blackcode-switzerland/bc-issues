// GET/POST /api/workspaces/{ws}/invitations — mounted from the shared factory.
//
// Class B (D-22): everything about the invitation is platform — it is to a
// WORKSPACE, not to an app — but the message announcing it carries this app's
// name, from-address and branding. So the sender is a named second argument.
//
// The accept link the factory builds is `<this origin>/invitations/{token}`, and
// this app serves that page at `app/invitations/[token]/page.tsx`. An app that
// mounts this route owes that page.

import { workspaceInvitationsRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'
import { sendInvitationEmail } from '@/lib/email/send'

const handlers = workspaceInvitationsRoute(appContext, { sendInvitationEmail })
export const GET = handlers.GET
export const POST = handlers.POST
