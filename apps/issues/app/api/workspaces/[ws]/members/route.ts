import { NextRequest } from 'next/server'
import { apiHandler, resolveWorkspace, jsonList } from '@/lib/api'
import { listWorkspaceMembers } from '@/lib/db/queries/workspaces'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const data = await listWorkspaceMembers(ctx.workspace.id)
  return jsonList(data)
})
