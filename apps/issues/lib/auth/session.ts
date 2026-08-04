import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getUserByEmail } from '@/lib/db/queries/users'
import type { User } from '@/lib/db/schema'

// Returns the current browser-session user only if the session is still valid:
//   - the user exists and isn't soft-deleted
//   - the session's password stamp matches the user's current
//     password_changed_at — a password reset bumps it, which invalidates every
//     session issued before the reset.
//
// API-token (Bearer) auth is intentionally NOT affected by this — tokens are
// separate, explicitly-managed credentials.
export async function getValidatedSessionUser(): Promise<User | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const user = await getUserByEmail(session.user.email)
  if (!user || user.deleted_at) return null
  const sessionStamp = session.user.pwStamp ?? 0
  const currentStamp = user.password_changed_at ? user.password_changed_at.getTime() : 0
  if (sessionStamp !== currentStamp) return null
  return user
}
