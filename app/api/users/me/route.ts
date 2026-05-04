import { NextRequest, NextResponse } from 'next/server'
import { resolveAuth } from '@/lib/auth/resolve'

export async function GET(request: NextRequest) {
  const auth = await resolveAuth(request)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { user, via } = auth
  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatar_url: user.avatar_url,
    role: user.role,
    via,
  })
}
