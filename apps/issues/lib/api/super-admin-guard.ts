import type { NextRequest } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { isSuperAdmin } from '@/lib/auth/whitelist'
import { Errors } from '@blackcode/platform-api'

export async function requireSuperAdminUser(req: NextRequest) {
  const user = await resolveUser(req)
  if (!user) throw Errors.unauthorized()
  if (!isSuperAdmin(user.email)) throw Errors.forbidden('Super admin access required')
  return user
}
