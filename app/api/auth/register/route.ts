import { NextRequest, NextResponse } from 'next/server'
import { createUserWithPassword, getUserByEmail } from '@/lib/db/queries/users'
import { hashPassword, validateEmail, validatePassword } from '@/lib/auth/password'

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string; name?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''
  const name = body.name?.trim() || null

  const emailErr = validateEmail(email)
  if (emailErr) {
    return NextResponse.json({ error: emailErr }, { status: 400 })
  }
  const passwordErr = validatePassword(password)
  if (passwordErr) {
    return NextResponse.json({ error: passwordErr }, { status: 400 })
  }

  const existing = await getUserByEmail(email)
  if (existing) {
    return NextResponse.json(
      {
        error: 'Email already registered',
        suggestion: 'Sign in instead, or use a different email',
      },
      { status: 409 }
    )
  }

  try {
    const password_hash = await hashPassword(password)
    const user = await createUserWithPassword({ email, password_hash, name })
    if (!user) {
      return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
    }
    return NextResponse.json(
      { id: user.id, email: user.email, name: user.name },
      { status: 201 }
    )
  } catch (error) {
    console.error('Register failed:', error)
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
  }
}
