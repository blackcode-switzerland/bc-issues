// Moved to @blackcode/platform-auth in Phase 6. `platform.users` is one table
// shared by every app, so "who may register" cannot be one app's decision.
//
// The package's functions take the database handle as their first argument — the
// same shape as `requireAppAccess` — because a platform package must not import
// an app's client. The wrappers here bind this app's `db` so every existing
// `@/lib/auth/whitelist` call site is unchanged.
import { db } from '@/lib/db/client'
import {
  isEmailAllowed as isEmailAllowedImpl,
  isEmailAllowedByDb as isEmailAllowedByDbImpl,
} from '@blackcode/platform-auth'

export { getSuperAdminEmails, isSuperAdmin, isWhitelistEnabled } from '@blackcode/platform-auth'

export function isEmailAllowed(email: string): Promise<boolean> {
  return isEmailAllowedImpl(db, email)
}

export function isEmailAllowedByDb(email: string): Promise<boolean> {
  return isEmailAllowedByDbImpl(db, email)
}
