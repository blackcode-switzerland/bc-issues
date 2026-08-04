import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors } from '@/lib/api'
import { requireSuperAdminUser } from '@/lib/api/super-admin-guard'
import { removeWhitelistEntry } from '@/lib/db/queries/whitelist'

interface Params {
  params: Promise<{ id: string }>
}

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  await requireSuperAdminUser(req)
  const { id } = await params
  const numId = parseInt(id, 10)
  if (isNaN(numId)) throw Errors.badRequest('invalid_id', 'id must be a number')
  await removeWhitelistEntry(numId)
  return NextResponse.json({ deleted: true })
})
