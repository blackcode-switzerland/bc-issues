// Password-reset OTPs — this app's binding.
//
// The logic moved to `@blackcode/platform-auth` on 2026-08-06 with
// `/api/me/password/*` (docs/sales-app-plan.md Phase 1b-C). One login serves
// every app — one `platform.users` row, one password — so letting each app
// implement its own would mean each app choosing its own OTP length, expiry and
// attempt cap against one shared credential, with the weakest setting the real
// floor. Same argument that put `hashPassword` there in Phase 6.
//
// Re-exported bound to this app's `db`, so the LOGGED-OUT flow
// (`/api/auth/password-reset/*`, which stays per-app like everything under
// `/api/auth`) is unchanged.

import { db } from '../client'
import {
  hashNewPassword as platformHashNewPassword,
  requestPasswordOtp as platformRequestPasswordOtp,
  verifyOtpAndResetPassword as platformVerifyOtpAndResetPassword,
  type RequestOtpResult,
  type VerifyResetResult,
} from '@blackcode/platform-auth'

export { OTP_EXPIRES_IN_MINUTES } from '@blackcode/platform-auth'
export type { RequestOtpResult, VerifyResetResult }

export function requestPasswordOtp(emailRaw: string): Promise<RequestOtpResult> {
  return platformRequestPasswordOtp(db, emailRaw)
}

export function verifyOtpAndResetPassword(
  emailRaw: string,
  otp: string,
  newPasswordHash: string
): Promise<VerifyResetResult> {
  return platformVerifyOtpAndResetPassword(db, emailRaw, otp, newPasswordHash)
}

/** Hash a validated plaintext password. Same implementation as sign-up. */
export function hashNewPassword(plaintext: string): Promise<string> {
  return platformHashNewPassword(plaintext)
}
