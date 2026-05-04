import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getUserByEmail } from '@/lib/db/queries/users'
import { revokeToken } from '@/lib/auth/tokens'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const tokenId = parseInt(id, 10)
  if (Number.isNaN(tokenId)) {
    return NextResponse.json(
      { error: 'Invalid token id', suggestion: 'Token id must be an integer' },
      { status: 400 }
    )
  }

  const ok = await revokeToken(tokenId, user.id)
  if (!ok) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({ success: true })
}
