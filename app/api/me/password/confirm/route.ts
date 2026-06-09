// In-app password change — step 2. Verifies the OTP sent to the signed-in
// user's email and sets the new password.

import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { validatePassword } from '@/lib/auth/password'
import {
  hashNewPassword,
  verifyOtpAndResetPassword,
} from '@/lib/db/queries/password-reset'

export const POST = apiHandler(async (req: NextRequest) => {
  const user = await resolveUser(req)
  if (!user) throw Errors.unauthorized()

  const body = await req.json().catch(() => null)
  const otp = typeof body?.otp === 'string' ? body.otp.trim() : ''
  const newPassword = typeof body?.new_password === 'string' ? body.new_password : ''

  if (!/^\d{6}$/.test(otp)) throw Errors.badRequest('invalid_otp', 'Enter the 6-digit code')
  const pwErr = validatePassword(newPassword)
  if (pwErr) throw Errors.badRequest('weak_password', pwErr)

  const hash = await hashNewPassword(newPassword)
  const result = await verifyOtpAndResetPassword(user.email, otp, hash)

  if (!result.ok) {
    switch (result.reason) {
      case 'no_pending_otp':
        throw Errors.badRequest('no_pending_otp', 'No active code. Request a new one.')
      case 'otp_expired':
        throw Errors.badRequest('otp_expired', 'This code has expired. Request a new one.')
      case 'too_many_attempts':
        throw Errors.badRequest('too_many_attempts', 'Too many attempts. Request a new code.')
      case 'invalid_otp':
        throw Errors.badRequest('invalid_otp', 'That code is incorrect.')
    }
  }

  return NextResponse.json({ ok: true })
})
