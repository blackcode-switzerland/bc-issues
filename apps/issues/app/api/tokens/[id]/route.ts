import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { apiHandler, Errors } from '@/lib/api'
import { authOptions } from '@/lib/auth'
import { getUserByEmail } from '@/lib/db/queries/users'
import { revokeToken } from '@/lib/auth/tokens'

interface Params {
  params: Promise<{ id: string }>
}

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Params) => {
  // Session-only, same rationale as /api/tokens.
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) throw Errors.unauthorized()
  const user = await getUserByEmail(session.user.email)
  if (!user) throw Errors.unauthorized()

  const { id } = await params
  const tokenId = parseInt(id, 10)
  if (Number.isNaN(tokenId)) throw Errors.badRequest('invalid_id', 'token id must be an integer')

  const ok = await revokeToken(tokenId, user.id)
  if (!ok) throw Errors.notFound('token')
  return NextResponse.json({ deleted: true })
})
