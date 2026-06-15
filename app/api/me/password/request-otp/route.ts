// In-app password change — step 1. Sends an OTP to the signed-in user's own
// email to confirm ownership before they set a new password. Works whether or
// not the user currently has a password (e.g. a Google user setting one).

import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import {
  OTP_EXPIRES_IN_MINUTES,
  requestPasswordOtp,
} from '@/lib/db/queries/password-reset'
import { sendPasswordResetEmail } from '@/lib/email/send'

export const POST = apiHandler(async (req: NextRequest) => {
  const user = await resolveUser(req)
  if (!user) throw Errors.unauthorized()

  const result = await requestPasswordOtp(user.email)

  if (result.status === 'rate_limited') {
    throw Errors.tooManyRequests('Too many codes requested. Try again in a few minutes.')
  }
  if (result.status === 'sent') {
    const send = await sendPasswordResetEmail(user.email, {
      otp: result.otp,
      expiresInMinutes: OTP_EXPIRES_IN_MINUTES,
      name: result.user.name,
    })
    if (!send.sent && process.env.NODE_ENV !== 'production') {
      console.log(`[password-reset] OTP for ${user.email}: ${result.otp}`)
    }
  }

  // Mask the email when echoing it back so the UI can show "we sent a code to
  // b•••@example.com" without exposing it in full.
  return NextResponse.json({ ok: true, email: maskEmail(user.email) })
})

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return email
  const head = local.slice(0, 1)
  return `${head}${'•'.repeat(Math.max(1, local.length - 1))}@${domain}`
}
