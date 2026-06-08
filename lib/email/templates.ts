// Email templates. Plain functions returning { subject, html, text }. We use
// inline styles because email clients strip <style> blocks and don't load
// external CSS. Keep it simple and robust — one column, system fonts.

const BRAND = 'Blackcode Issues'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface InvitationEmailInput {
  workspaceName: string
  inviterName: string // display name or email of the inviter
  acceptUrl: string
  inviteeHasAccount: boolean
  expiresInDays: number
}

export function invitationEmail(input: InvitationEmailInput): {
  subject: string
  html: string
  text: string
} {
  const ws = escapeHtml(input.workspaceName)
  const inviter = escapeHtml(input.inviterName)
  const url = input.acceptUrl
  const subject = `${input.inviterName} invited you to join ${input.workspaceName} on ${BRAND}`

  const accountLine = input.inviteeHasAccount
    ? `Sign in and accept to start collaborating.`
    : `You'll create a free account when you accept — it takes a few seconds.`

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0b0b10;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b10;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0"
            style="max-width:480px;width:100%;background:#15151d;border:1px solid #25252e;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 24px;">
                <p style="margin:0 0 4px;color:#a1a1aa;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">${BRAND}</p>
                <h1 style="margin:0 0 16px;color:#e7e7ee;font-size:20px;font-weight:600;line-height:1.3;">
                  You've been invited to join ${ws}
                </h1>
                <p style="margin:0 0 8px;color:#c4c4cd;font-size:14px;line-height:1.6;">
                  <strong style="color:#e7e7ee;">${inviter}</strong> invited you to collaborate in
                  <strong style="color:#e7e7ee;">${ws}</strong>.
                </p>
                <p style="margin:0 0 24px;color:#a1a1aa;font-size:14px;line-height:1.6;">
                  ${accountLine}
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:10px;background:#3b82f6;">
                      <a href="${url}"
                        style="display:inline-block;padding:11px 22px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;">
                        Accept invitation
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;color:#71717a;font-size:12px;line-height:1.6;">
                  This invitation expires in ${input.expiresInDays} days. If the button doesn't work,
                  copy and paste this link into your browser:<br/>
                  <a href="${url}" style="color:#60a5fa;word-break:break-all;">${url}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid #25252e;">
                <p style="margin:0;color:#52525b;font-size:12px;line-height:1.5;">
                  If you weren't expecting this invitation, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  const text = [
    `${input.inviterName} invited you to join ${input.workspaceName} on ${BRAND}.`,
    ``,
    input.inviteeHasAccount
      ? `Sign in and accept to start collaborating.`
      : `You'll create a free account when you accept.`,
    ``,
    `Accept the invitation:`,
    url,
    ``,
    `This invitation expires in ${input.expiresInDays} days.`,
    `If you weren't expecting this, you can ignore this email.`,
  ].join('\n')

  return { subject, html, text }
}
