import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { getTransactionLog, undoLastOperations } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const log = await getTransactionLog(50)
    return NextResponse.json(log)
  } catch (error) {
    console.error('Failed to fetch transaction log:', error)
    return NextResponse.json({ error: 'Failed to fetch transaction log' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = await request.json()
    const count = Math.min(Math.max(body.count || 1, 1), 10)
    const undone = await undoLastOperations(user.id, count)
    return NextResponse.json({
      success: true,
      undone_count: undone.length,
      operations: undone,
    })
  } catch (error) {
    console.error('Failed to undo operations:', error)
    return NextResponse.json({ error: 'Failed to undo operations' }, { status: 500 })
  }
}
