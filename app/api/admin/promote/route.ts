import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { resolveUser } from '@/lib/auth/resolve'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.id !== 1) {
      return NextResponse.json({ error: 'Only the original owner can use this' }, { status: 403 })
    }

    const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'))
    if (admins.length > 0) {
      return NextResponse.json(
        {
          error: 'Admin already exists',
          message: 'This bootstrap endpoint can only be used once',
        },
        { status: 400 }
      )
    }

    await db.update(users).set({ role: 'admin' }).where(eq(users.id, 1))

    return NextResponse.json({
      success: true,
      message: 'You are now an admin!',
    })
  } catch (error) {
    console.error('Promote failed:', error)
    return NextResponse.json(
      { error: 'Promote failed', details: String(error) },
      { status: 500 }
    )
  }
}
