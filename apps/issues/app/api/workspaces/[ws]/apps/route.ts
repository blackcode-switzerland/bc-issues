// GET /api/workspaces/{ws}/apps — which apps this workspace runs, and how each
// hands out access.
//
// Readable by any member (you should be able to see why a colleague can reach
// something you cannot); changing anything is owner-only, see [app]/route.ts.

import { NextRequest } from 'next/server'
import { apiHandler, resolveWorkspace, jsonList } from '@/lib/api'
import { db } from '@/lib/db/client'
import { listWorkspaceApps } from '@blackcode/platform-db'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  return jsonList(await listWorkspaceApps(db, ctx.workspace.id))
})
