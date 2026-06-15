import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors } from '@/lib/api'
import { requireSuperAdminUser } from '@/lib/api/super-admin-guard'
import { listWhitelist, addWhitelistEntry } from '@/lib/db/queries/whitelist'

const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const GET = apiHandler(async (req: NextRequest) => {
  await requireSuperAdminUser(req)
  const data = await listWhitelist()
  return NextResponse.json({ data })
})

export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireSuperAdminUser(req)
  const body = await req.json().catch(() => null)
  const type = body?.type as string
  const value = (body?.value as string)?.trim().toLowerCase()

  if (type !== 'email' && type !== 'domain') {
    throw Errors.badRequest('invalid_type', 'type must be "email" or "domain"')
  }
  if (!value) {
    throw Errors.badRequest('missing_value', 'value is required')
  }
  if (type === 'email' && !EMAIL_RE.test(value)) {
    throw Errors.badRequest('invalid_email', 'not a valid email address')
  }
  if (type === 'domain' && !DOMAIN_RE.test(value)) {
    throw Errors.badRequest('invalid_domain', 'not a valid domain (e.g. blackcode.ch)')
  }

  const entry = await addWhitelistEntry({ type, value, added_by: user.id })
  if (!entry) {
    // onConflictDoNothing returned nothing — entry already exists
    return NextResponse.json({ message: 'Already in whitelist' }, { status: 200 })
  }
  return NextResponse.json({ entry }, { status: 201 })
})
