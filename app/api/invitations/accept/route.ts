import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { acceptInvitation } from '@/lib/db/queries/invitations'

export const POST = apiHandler(async (req: NextRequest) => {
  const user = await resolveUser(req)
  if (!user) throw Errors.unauthorized()

  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!token) throw Errors.badRequest('invalid_token', 'token is required')

  const result = await acceptInvitation(token, user.id, user.email)
  if (!result.ok) {
    switch (result.reason) {
      case 'not_found':
        throw Errors.notFound('invitation')
      case 'expired':
        throw Errors.conflict('invitation_expired', 'This invitation has expired')
      case 'revoked':
        throw Errors.conflict('invitation_revoked', 'This invitation was revoked')
      case 'accepted':
        throw Errors.conflict('invitation_already_accepted', 'This invitation was already accepted')
      case 'declined':
        throw Errors.conflict('invitation_declined', 'This invitation was declined')
      case 'email_mismatch':
        // Don't disclose whose email the token was for.
        throw Errors.forbidden('This invitation is not for your account')
    }
  }
  return NextResponse.json({
    accepted: true,
    workspace_id: result.workspace_id,
    already_member: result.already_member,
  })
})
