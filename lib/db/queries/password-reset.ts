// Password-reset OTP logic. Shared by the logged-out "forgot password" flow
// and the in-app settings flow.
//
// Security model:
//   - 6-digit numeric code; we store only sha256(email + ':' + otp).
//   - Codes expire in 10 minutes.
//   - Each code allows up to 5 verification attempts, then it's dead.
//   - At most 5 codes can be requested per email per 15 minutes (rate limit).
//   - Requesting a new code invalidates any prior pending codes for the email.
//   - verifyAndReset() consumes the code and sets the new password atomically,
//     so a verified code can't be replayed.

import { createHash, randomInt } from 'crypto'
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '../client'
import { passwordResetOtps, users, type User } from '../schema'
import { hashPassword } from '@/lib/auth/password'

const OTP_TTL_MINUTES = 10
const MAX_ATTEMPTS = 5
const RATE_WINDOW_MINUTES = 15
const RATE_MAX_REQUESTS = 5

export const OTP_EXPIRES_IN_MINUTES = OTP_TTL_MINUTES

function generateOtp(): string {
  // 6 digits, zero-padded. randomInt is crypto-strong.
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function hashOtp(email: string, otp: string): string {
  return createHash('sha256').update(`${email.toLowerCase()}:${otp}`).digest('hex')
}

async function getActiveUserByEmail(email: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(users)
    .where(and(sql`lower(${users.email}) = ${email.toLowerCase()}`, isNull(users.deleted_at)))
    .limit(1)
  return rows[0] ?? null
}

export type RequestOtpResult =
  | { status: 'sent'; otp: string; user: User }
  | { status: 'no_account' }
  | { status: 'rate_limited' }

// Creates a fresh OTP for the email if an active account exists. Returns the
// plaintext OTP so the caller can email it. Callers in the public flow should
// treat 'no_account' the same as 'sent' to the client (don't leak existence).
export async function requestPasswordOtp(emailRaw: string): Promise<RequestOtpResult> {
  const email = emailRaw.trim().toLowerCase()

  const user = await getActiveUserByEmail(email)
  if (!user) return { status: 'no_account' }

  // Rate limit per email.
  const windowStart = new Date(Date.now() - RATE_WINDOW_MINUTES * 60_000)
  const recent = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(passwordResetOtps)
    .where(
      and(
        sql`lower(${passwordResetOtps.email}) = ${email}`,
        gt(passwordResetOtps.created_at, windowStart)
      )
    )
  if ((recent[0]?.count ?? 0) >= RATE_MAX_REQUESTS) {
    return { status: 'rate_limited' }
  }

  const otp = generateOtp()
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000)

  await db.transaction(async (tx) => {
    // Invalidate any prior pending (unconsumed) codes for this email.
    await tx
      .update(passwordResetOtps)
      .set({ consumed_at: new Date() })
      .where(
        and(
          sql`lower(${passwordResetOtps.email}) = ${email}`,
          isNull(passwordResetOtps.consumed_at)
        )
      )
    await tx.insert(passwordResetOtps).values({
      email,
      user_id: user.id,
      otp_hash: hashOtp(email, otp),
      expires_at: expiresAt,
    })
  })

  return { status: 'sent', otp, user }
}

export type VerifyResetResult =
  | { ok: true }
  | { ok: false; reason: 'no_pending_otp' | 'otp_expired' | 'too_many_attempts' | 'invalid_otp' }

// Verifies the OTP and, on success, sets the new password — atomically, so a
// correct code is consumed exactly once. The new password must already be
// validated by the caller (length etc.).
export async function verifyOtpAndResetPassword(
  emailRaw: string,
  otp: string,
  newPasswordHash: string
): Promise<VerifyResetResult> {
  const email = emailRaw.trim().toLowerCase()

  return await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(passwordResetOtps)
      .where(
        and(
          sql`lower(${passwordResetOtps.email}) = ${email}`,
          isNull(passwordResetOtps.consumed_at)
        )
      )
      .orderBy(desc(passwordResetOtps.created_at))
      .limit(1)

    const record = rows[0]
    if (!record) return { ok: false, reason: 'no_pending_otp' }

    if (record.expires_at.getTime() < Date.now()) {
      await tx
        .update(passwordResetOtps)
        .set({ consumed_at: new Date() })
        .where(eq(passwordResetOtps.id, record.id))
      return { ok: false, reason: 'otp_expired' }
    }

    if (record.attempts >= MAX_ATTEMPTS) {
      await tx
        .update(passwordResetOtps)
        .set({ consumed_at: new Date() })
        .where(eq(passwordResetOtps.id, record.id))
      return { ok: false, reason: 'too_many_attempts' }
    }

    const expected = hashOtp(email, otp)
    if (expected !== record.otp_hash) {
      await tx
        .update(passwordResetOtps)
        .set({ attempts: record.attempts + 1 })
        .where(eq(passwordResetOtps.id, record.id))
      return { ok: false, reason: 'invalid_otp' }
    }

    // Success: consume the code and set the password.
    await tx
      .update(passwordResetOtps)
      .set({ consumed_at: new Date() })
      .where(eq(passwordResetOtps.id, record.id))

    // Bumping password_changed_at invalidates every existing browser session
    // for this account — sessions carry a snapshot of this timestamp.
    await tx
      .update(users)
      .set({
        password_hash: newPasswordHash,
        password_changed_at: new Date(),
        updated_at: new Date(),
      })
      .where(and(sql`lower(${users.email}) = ${email}`, isNull(users.deleted_at)))

    return { ok: true }
  })
}

// Helper used by both routes to hash a validated plaintext password.
export async function hashNewPassword(plaintext: string): Promise<string> {
  return hashPassword(plaintext)
}
