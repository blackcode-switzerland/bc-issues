import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { listPendingInvitationsForEmail } from '@/lib/db/queries/invitations'

export const GET = apiHandler(async (req: NextRequest) => {
  const user = await resolveUser(req)
  if (!user) throw Errors.unauthorized()
  const data = await listPendingInvitationsForEmail(user.email)
  return NextResponse.json({ data })
})
