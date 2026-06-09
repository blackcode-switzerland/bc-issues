// Email templates — light theme, single shared layout. Plain functions
// returning { subject, html, text }. Inline styles only (email clients strip
// <style> blocks). One column, system fonts, ~520px max width.
//
// Brand logo: referenced by absolute URL (NEXTAUTH_URL + /logo.png) so it
// renders in Gmail/Outlook/Apple Mail. (Base64 data-URIs are blocked by Gmail
// and a 77KB logo would also exceed Gmail's ~102KB clipping limit, so a hosted
// URL is the professional choice.) The "Blackcode Issues" wordmark always
// shows as text, so the brand is clear even if images are blocked.

const BRAND = 'Blackcode Issues'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function appUrl(): string {
  return (process.env.NEXTAUTH_URL ?? '').replace(/\/$/, '')
}

// Light-theme palette
const C = {
  page: '#f4f5f7',
  card: '#ffffff',
  border: '#e6e7eb',
  heading: '#111114',
  body: '#3f3f46',
  muted: '#71717a',
  faint: '#a1a1aa',
  accent: '#2563eb',
  codeBg: '#f4f4f6',
}

// Wraps content in the shared shell: brand header, white card, footer.
function renderEmail(opts: { previewText: string; contentHtml: string }): string {
  const base = appUrl()
  const logo = base
    ? `<img src="${base}/logo.png" width="28" height="28" alt="${BRAND}"
         style="display:inline-block;vertical-align:middle;border-radius:6px;border:0;" />`
    : ''

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light" />
  </head>
  <body style="margin:0;padding:0;background:${C.page};-webkit-font-smoothing:antialiased;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <span style="display:none!important;opacity:0;color:transparent;visibility:hidden;height:0;width:0;overflow:hidden;">${escapeHtml(
      opts.previewText
    )}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
            <!-- brand -->
            <tr>
              <td style="padding:0 4px 16px;">
                <span style="vertical-align:middle;">${logo}</span>
                <span style="vertical-align:middle;margin-left:${logo ? '8px' : '0'};color:${C.heading};font-size:16px;font-weight:600;letter-spacing:-0.01em;">
                  ${BRAND}
                </span>
              </td>
            </tr>
            <!-- card -->
            <tr>
              <td style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:32px;">
                ${opts.contentHtml}
              </td>
            </tr>
            <!-- footer -->
            <tr>
              <td style="padding:16px 4px 0;">
                <p style="margin:0;color:${C.faint};font-size:12px;line-height:1.5;">
                  This is an automated message from ${BRAND}.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function buttonHtml(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0;">
    <tr>
      <td style="border-radius:10px;background:${C.accent};">
        <a href="${url}"
          style="display:inline-block;padding:11px 22px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`
}

// ---------- invitation ----------

export interface InvitationEmailInput {
  workspaceName: string
  inviterName: string
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
  const subject = `${input.inviterName} invited you to join ${input.workspaceName}`
  const accountLine = input.inviteeHasAccount
    ? 'Sign in and accept to start collaborating.'
    : "You'll create a free account when you accept — it takes a few seconds."

  const content = `
    <h1 style="margin:0 0 14px;color:${C.heading};font-size:20px;font-weight:600;line-height:1.3;">
      You're invited to join ${ws}
    </h1>
    <p style="margin:0 0 8px;color:${C.body};font-size:14px;line-height:1.6;">
      <strong style="color:${C.heading};">${inviter}</strong> invited you to collaborate in
      <strong style="color:${C.heading};">${ws}</strong> on ${BRAND}.
    </p>
    <p style="margin:0 0 22px;color:${C.muted};font-size:14px;line-height:1.6;">
      ${accountLine}
    </p>
    ${buttonHtml(url, 'Accept invitation')}
    <p style="margin:22px 0 0;color:${C.faint};font-size:12px;line-height:1.6;">
      This invitation expires in ${input.expiresInDays} days. If the button doesn't work,
      copy and paste this link into your browser:<br/>
      <a href="${url}" style="color:${C.accent};word-break:break-all;">${url}</a>
    </p>
    <p style="margin:14px 0 0;color:${C.faint};font-size:12px;line-height:1.6;">
      If you weren't expecting this, you can safely ignore this email.
    </p>`

  const html = renderEmail({
    previewText: `${input.inviterName} invited you to join ${input.workspaceName} on ${BRAND}.`,
    contentHtml: content,
  })

  const text = [
    `${input.inviterName} invited you to join ${input.workspaceName} on ${BRAND}.`,
    ``,
    input.inviteeHasAccount
      ? 'Sign in and accept to start collaborating.'
      : "You'll create a free account when you accept.",
    ``,
    `Accept the invitation:`,
    url,
    ``,
    `This invitation expires in ${input.expiresInDays} days.`,
    `If you weren't expecting this, you can ignore this email.`,
  ].join('\n')

  return { subject, html, text }
}

// ---------- password reset ----------

export interface PasswordResetEmailInput {
  otp: string
  expiresInMinutes: number
  name?: string | null
}

export function passwordResetEmail(input: PasswordResetEmailInput): {
  subject: string
  html: string
  text: string
} {
  const greeting = input.name ? `Hi ${escapeHtml(input.name)},` : 'Hi,'
  const subject = `Your ${BRAND} password reset code`
  const code = escapeHtml(input.otp)

  const content = `
    <h1 style="margin:0 0 14px;color:${C.heading};font-size:20px;font-weight:600;line-height:1.3;">
      Reset your password
    </h1>
    <p style="margin:0 0 20px;color:${C.body};font-size:14px;line-height:1.6;">
      ${greeting} use the code below to reset your password. It expires in
      ${input.expiresInMinutes} minutes.
    </p>
    <div style="margin:0 0 20px;padding:16px;background:${C.codeBg};border:1px solid ${C.border};border-radius:12px;text-align:center;">
      <span style="color:${C.heading};font-size:30px;font-weight:700;letter-spacing:.3em;font-family:'SF Mono',ui-monospace,Menlo,Consolas,monospace;">${code}</span>
    </div>
    <p style="margin:0;color:${C.faint};font-size:12px;line-height:1.6;">
      If you didn't request this, you can safely ignore this email — your password
      won't change. Never share this code with anyone.
    </p>`

  const html = renderEmail({
    previewText: `Your ${BRAND} password reset code is ${input.otp}.`,
    contentHtml: content,
  })

  const text = [
    `${input.name ? `Hi ${input.name},` : 'Hi,'}`,
    ``,
    `Use this code to reset your ${BRAND} password:`,
    ``,
    `    ${input.otp}`,
    ``,
    `It expires in ${input.expiresInMinutes} minutes. If you didn't request this, ignore`,
    `this email — your password won't change. Never share this code with anyone.`,
  ].join('\n')

  return { subject, html, text }
}
