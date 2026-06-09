// Public "forgot password" — step 1. Emails a 6-digit OTP if an account
// exists. Always returns { ok: true } regardless, so the endpoint can't be
// used to enumerate which emails have accounts.

import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors } from '@/lib/api'
import { validateEmail } from '@/lib/auth/password'
import {
  OTP_EXPIRES_IN_MINUTES,
  requestPasswordOtp,
} from '@/lib/db/queries/password-reset'
import { sendPasswordResetEmail } from '@/lib/email/send'

export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const emailErr = validateEmail(email)
  if (emailErr) throw Errors.badRequest('invalid_email', emailErr)

  const result = await requestPasswordOtp(email)

  if (result.status === 'sent') {
    const send = await sendPasswordResetEmail(email, {
      otp: result.otp,
      expiresInMinutes: OTP_EXPIRES_IN_MINUTES,
      name: result.user.name,
    })
    // Dev affordance: when email isn't actually delivered (Resend not
    // configured, or test-mode restriction), surface the code in the server
    // log so local testing works. Never in production.
    if (!send.sent && process.env.NODE_ENV !== 'production') {
      console.log(`[password-reset] OTP for ${email}: ${result.otp}`)
    }
  }

  // Generic response in every case (no_account / rate_limited included).
  return NextResponse.json({ ok: true })
})
