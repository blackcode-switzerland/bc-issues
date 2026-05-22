import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { listMyWorkspaces } from '@/lib/db/queries/workspaces'

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()
  const data = await listMyWorkspaces(user.id)
  return NextResponse.json({ data })
})
