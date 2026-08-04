import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api'
import { requireSuperAdminUser } from '@/lib/api/super-admin-guard'
import { listAllPlatformUsers } from '@/lib/db/queries/admin'
import { getSuperAdminEmails } from '@/lib/auth/whitelist'

export const GET = apiHandler(async (req: NextRequest) => {
  await requireSuperAdminUser(req)
  const users = await listAllPlatformUsers()
  const superAdminEmails = new Set(getSuperAdminEmails())
  return NextResponse.json({
    data: users.map((u) => ({
      ...u,
      is_super_admin: superAdminEmails.has(u.email.toLowerCase()),
    })),
  })
})
