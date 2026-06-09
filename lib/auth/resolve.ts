import type { User } from '@/lib/db/schema'
import { verifyToken } from './tokens'
import { getValidatedSessionUser } from './session'

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

  // Validates soft-delete + password-reset invalidation in one place.
  const user = await getValidatedSessionUser()
  return user ? { user, via: 'session' } : null
}

export async function resolveUser(req: Request): Promise<User | null> {
  const result = await resolveAuth(req)
  return result?.user ?? null
}
