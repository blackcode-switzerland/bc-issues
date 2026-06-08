// Email sending — best-effort. Sending must never break the operation that
// triggered it (e.g. an invitation is still valid even if its email bounces).
// On failure we log a warn-level error_event and return { sent: false }.
//
// For now, the only transactional email we send is the workspace invitation.
// Everything else stays in the in-app inbox.

import { emailEnabled, fromAddress, getResend } from './client'
import { invitationEmail, type InvitationEmailInput } from './templates'
import { insertErrorEvent } from '@/lib/db/queries/error-events'

export interface SendResult {
  sent: boolean
  skipped?: 'not_configured'
  error?: string
}

export async function sendInvitationEmail(
  to: string,
  input: InvitationEmailInput
): Promise<SendResult> {
  if (!emailEnabled()) {
    return { sent: false, skipped: 'not_configured' }
  }
  const resend = getResend()
  if (!resend) return { sent: false, skipped: 'not_configured' }

  const { subject, html, text } = invitationEmail(input)

  try {
    const { error } = await resend.emails.send({
      from: fromAddress(),
      to,
      subject,
      html,
      text,
    })
    if (error) {
      await logEmailFailure(to, error.message ?? String(error))
      return { sent: false, error: error.message ?? 'send failed' }
    }
    return { sent: true }
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown'
    await logEmailFailure(to, message)
    return { sent: false, error: message }
  }
}

async function logEmailFailure(to: string, message: string): Promise<void> {
  try {
    await insertErrorEvent({
      level: 'warn',
      code: 'email_send_failed',
      message: `Invitation email failed: ${message}`,
      stack: null,
      route: '/api/workspaces/[ws]/invitations',
      method: 'POST',
      status_code: null,
      user_id: null,
      workspace_id: null,
      // Domain only — never store the full recipient address.
      context: { recipient_domain: to.split('@')[1] ?? null },
    })
  } catch {
    // Logging is itself best-effort.
  }
}
