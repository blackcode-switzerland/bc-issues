import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { getAnalytics } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden', suggestion: 'Analytics is restricted to admins' },
        { status: 403 }
      )
    }

    const analytics = await getAnalytics()
    return NextResponse.json(analytics)
  } catch (error) {
    console.error('Failed to fetch analytics:', error)
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 })
  }
}
