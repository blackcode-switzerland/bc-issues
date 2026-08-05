// Who may exist on the platform at all: super admins, and the email/domain
// whitelist that gates registration and OAuth first login.
//
// Platform, not app, for a structural reason rather than a tidiness one:
// `platform.users` is ONE table shared by every app (PLATFORM-ARCHITECTURE.md
// §4.5 — identity is global, access is per app). An app deciding for itself who
// may register would be an app deciding who exists in every other app. Access to
// a particular app is a different question and a different table; that is
// `requireAppAccess`.
//
// `SUPER_ADMINS` (comma-separated emails) is read per call, never cached at
// import: it is an environment variable that can change between deploys, and a
// module-level snapshot would keep serving the old list until the next cold start.
//
// The whitelist is ACTIVE ONLY WHEN `SUPER_ADMINS` IS SET. That coupling is
// deliberate and predates this move: an empty super-admin list with an enforced
// whitelist is a platform nobody can get into and nobody can let anyone into.

import { sql } from 'drizzle-orm'
import { emailWhitelist, type Executor } from '@blackcode/platform-db'

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

/** True if the exact address, or its whole domain, is whitelisted. */
export async function isEmailAllowedByDb(db: Executor, email: string): Promise<boolean> {
  const domain = email.split('@')[1]
  if (!domain) return false
  const res = await db.execute(sql`
    SELECT 1 FROM ${emailWhitelist}
    WHERE (type = 'email'  AND value = ${email})
       OR (type = 'domain' AND value = ${domain})
    LIMIT 1
  `)
  return res.rows.length > 0
}

/** The full gate: disabled whitelist, or super admin, or a whitelisted entry. */
export async function isEmailAllowed(db: Executor, email: string): Promise<boolean> {
  if (!isWhitelistEnabled()) return true
  const normalized = email.toLowerCase()
  if (isSuperAdmin(normalized)) return true
  return isEmailAllowedByDb(db, normalized)
}
