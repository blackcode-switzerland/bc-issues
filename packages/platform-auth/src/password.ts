// Password hashing and the two input validators that go with it.
//
// Moved here from apps/issues/lib/auth/password.ts in Phase 6, unchanged. It is
// the easiest of the auth modules to place: it touches no database and no
// request, so a second app needs it exactly as-is, and the alternative — each app
// choosing its own cost factor and its own minimum length — is a suite where the
// weakest app sets the real security floor for one shared `platform.users` table.

import bcrypt from 'bcryptjs'

const ROUNDS = 12

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, ROUNDS)
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash)
}

export function validatePassword(plaintext: string): string | null {
  if (typeof plaintext !== 'string') return 'Password is required'
  if (plaintext.length < 8) return 'Password must be at least 8 characters'
  if (plaintext.length > 200) return 'Password is too long (max 200 characters)'
  return null
}

export function validateEmail(email: string): string | null {
  if (typeof email !== 'string' || !email.trim()) return 'Email is required'
  if (email.length > 255) return 'Email is too long'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Invalid email format'
  return null
}
