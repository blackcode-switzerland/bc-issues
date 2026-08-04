import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace } from '@/lib/api'
import { removeMember } from '@/lib/db/queries/workspaces'

interface Params {
  params: Promise<{ ws: string }>
}

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)

  if (ctx.role === 'owner') {
    throw Errors.conflict(
      'owner_cannot_leave',
      'Transfer ownership before leaving the workspace'
    )
  }

  await removeMember(ctx.workspace.id, ctx.user.id, ctx.user.id)
  return NextResponse.json({ left: true })
})
