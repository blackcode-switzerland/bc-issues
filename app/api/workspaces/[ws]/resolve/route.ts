import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace } from '@/lib/api'
import { resolveSeqToId, type LocatableType } from '@/lib/db/queries/locate'

interface Params {
  params: Promise<{ ws: string }>
}

const TYPES: LocatableType[] = ['issue', 'task', 'project']

// GET /api/workspaces/{ws}/resolve?type=issue|task|project&seq=N
//
// Maps a workspace-scoped #number (seq) to the global id used by the rest of
// the API. The detail pages — whose URLs are /dashboard/{ws}/{type}/{seq} —
// call this once, then reuse the existing id-based endpoints. Membership is
// gated by resolveWorkspace.
export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)

  const sp = req.nextUrl.searchParams
  const type = sp.get('type') as LocatableType | null
  if (!type || !TYPES.includes(type)) {
    throw Errors.badRequest('invalid_type', 'type must be one of issue, task, project')
  }
  const seq = parseInt(sp.get('seq') ?? '')
  if (Number.isNaN(seq)) throw Errors.badRequest('invalid_seq', 'seq must be an integer')

  const id = await resolveSeqToId(ctx.workspace.id, type, seq)
  if (id == null) throw Errors.notFound(type)

  return NextResponse.json({ type, seq, id, workspace_slug: ctx.workspace.slug })
})
