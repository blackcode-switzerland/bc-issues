import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { declineInvitation } from '@/lib/db/queries/invitations'

export const POST = apiHandler(async (req: NextRequest) => {
  const user = await resolveUser(req)
  if (!user) throw Errors.unauthorized()

  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!token) throw Errors.badRequest('invalid_token', 'token is required')

  const result = await declineInvitation(token, user.id, user.email)
  if (!result.ok) {
    switch (result.reason) {
      case 'not_found':
        throw Errors.notFound('invitation')
      case 'email_mismatch':
        throw Errors.forbidden('This invitation is not for your account')
      case 'already_resolved':
        throw Errors.conflict(
          'invitation_already_resolved',
          'This invitation is no longer pending'
        )
    }
  }
  return NextResponse.json({ declined: true })
})
