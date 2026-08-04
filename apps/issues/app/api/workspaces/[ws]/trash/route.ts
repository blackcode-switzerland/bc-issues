// GET /api/workspaces/[ws]/trash — list the recycle bin. Any workspace member.
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace } from '@/lib/api'
import { listTrash, type TrashType } from '@/lib/db/queries/deletion'

interface Params {
  params: Promise<{ ws: string }>
}

const TYPES = new Set<TrashType>(['issue', 'project', 'task'])

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)

  const sp = req.nextUrl.searchParams
  const typeRaw = sp.get('type')
  let type: TrashType | undefined
  if (typeRaw) {
    if (!TYPES.has(typeRaw as TrashType)) {
      throw Errors.badRequest('invalid_type', 'type must be issue, project, or task')
    }
    type = typeRaw as TrashType
  }
  const limit = sp.get('limit') ? parseInt(sp.get('limit')!) : undefined
  const offset = sp.get('offset') ? parseInt(sp.get('offset')!) : undefined

  const data = await listTrash(ctx.workspace.id, { type, limit, offset })
  return NextResponse.json({ data })
})
