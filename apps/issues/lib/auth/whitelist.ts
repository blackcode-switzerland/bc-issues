// Super admin + email whitelist utilities.
//
// SUPER_ADMINS env var:  comma-separated email list of platform super admins.
//                        Super admins bypass all whitelist checks and gain access
//                        to the /dashboard/super-admin section.
//
// Whitelist feature is active when SUPER_ADMINS is set (non-empty).
// When active, only whitelisted emails/domains + super admins can register
// or sign in via Google OAuth.

import { isEmailAllowedByDb } from '@/lib/db/queries/whitelist'

export function getSuperAdminEmails(): string[] {
  return (process.env.SUPER_ADMINS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export function isSuperAdmin(email: string): boolean {
  const admins = getSuperAdminEmails()
  return admins.length > 0 && admins.includes(email.toLowerCase())
}

export function isWhitelistEnabled(): boolean {
  return getSuperAdminEmails().length > 0
}

export async function isEmailAllowed(email: string): Promise<boolean> {
  if (!isWhitelistEnabled()) return true
  const normalized = email.toLowerCase()
  if (isSuperAdmin(normalized)) return true
  return isEmailAllowedByDb(normalized)
}
