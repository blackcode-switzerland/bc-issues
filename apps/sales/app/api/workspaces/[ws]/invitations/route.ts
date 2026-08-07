// GET|POST /api/workspaces/{ws}/invitations — `bk invite list | send`.
//
// ---------------------------------------------------------------------------
// THIS DEPLOYMENT DOES NOT SEND THE EMAIL, AND THAT IS A CHOICE, NOT A GAP
// ---------------------------------------------------------------------------
// The factory takes an `InvitationSender` because putting an invitation in front
// of a person is the one part only an app can do. `apps/issues` supplies Resend;
// `apps/sales` has no email provider and is not gaining one to mount a route.
//
// So this passes a sender that reports `{ sent: false }` — WHICH IS NOT A NEW
// STATE. It is byte-for-byte what `apps/issues` already returns whenever
// RESEND_API_KEY is unset (`lib/email/send.ts`: `{ sent: false, skipped:
// 'not_configured' }`), which is every local and preview environment. The
// invitation row is created either way, and the response carries the accept URL,
// which is the actual delivery mechanism for an agent: `bk invite send` prints
// a link you hand over.
//
// The alternative was to leave this unmounted. That is worse: `bk invite send`
// is a bare verb, and a bare verb that 404s from the host you are homed on is a
// dead end, whereas an invitation with an unsent email is a working invitation
// with a link. The contract already says a bounced email never invalidates one.
//
// **If sales ever needs to actually send**, it needs the email package, not an
// edit here — and at that point the honest question is whether an invitation
// should look different depending on which host received it (D-28: "would two
// deployments answer differently?"). Today they differ only in whether an email
// went out, and only where issues has a key and sales never will.

import { workspaceInvitationsRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

/**
 * No provider on this deployment. Reports honestly and never throws, which the
 * `InvitationSender` contract requires: a send failure must not cost the caller
 * the invitation.
 */
async function sendInvitationEmail(): Promise<{ sent: boolean }> {
  return { sent: false }
}

const handlers = workspaceInvitationsRoute(appContext, { sendInvitationEmail })
export const GET = handlers.GET
export const POST = handlers.POST
