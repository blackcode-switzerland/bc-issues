import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getUserByEmail } from '@/lib/db/queries/users'
import type { User } from '@/lib/db/schema'
import { verifyToken } from './tokens'

export interface AuthSource {
  user: User
  via: 'session' | 'token'
}

export async function resolveAuth(req: Request): Promise<AuthSource | null> {
  const auth = req.headers.get('authorization')
  if (auth && /^Bearer\s+/i.test(auth)) {
    const plaintext = auth.replace(/^Bearer\s+/i, '').trim()
    const user = await verifyToken(plaintext)
    return user ? { user, via: 'token' } : null
  }

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const user = await getUserByEmail(session.user.email)
  return user ? { user, via: 'session' } : null
}

export async function resolveUser(req: Request): Promise<User | null> {
  const result = await resolveAuth(req)
  return result?.user ?? null
}
