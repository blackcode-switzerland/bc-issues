// The user directory. Privacy guard: a caller only sees users they already
// share a workspace with (plus themselves). Discovering brand-new people is
// not possible here — invitations are sent blind, by email.

import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { getVisibleUsers } from '@/lib/db/queries/users'

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()
  const users = await getVisibleUsers(user.id)
  return NextResponse.json(users)
})
