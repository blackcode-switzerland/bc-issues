import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { getWorkspaceForUser } from '@/lib/db/queries/workspaces'
import { locateEntity, type LocatableType } from '@/lib/db/queries/locate'

const TYPES: LocatableType[] = ['issue', 'task', 'project']

// GET /api/me/locate?type=issue|task|project&id=N
//
// Resolves a globally-unique entity id to its owning workspace, so a shared
// deep link works for any member regardless of their active workspace. Gates on
// membership: non-members (and missing entities) get 404 — we never reveal that
// an entity exists in a workspace the caller can't see.
export const GET = apiHandler(async (req: NextRequest) => {
  const user = await resolveUser(req)
  if (!user) throw Errors.unauthorized()

  const sp = req.nextUrl.searchParams
  const type = sp.get('type') as LocatableType | null
  if (!type || !TYPES.includes(type)) {
    throw Errors.badRequest('invalid_type', 'type must be one of issue, task, project')
  }
  const id = parseInt(sp.get('id') ?? '')
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')

  const location = await locateEntity(type, id)
  if (location == null) throw Errors.notFound(type)

  const ws = await getWorkspaceForUser(String(location.workspace_id), user.id)
  if (!ws) throw Errors.notFound(type)

  return NextResponse.json({
    type,
    id,
    seq: location.seq,
    workspace_id: ws.id,
    workspace_slug: ws.slug,
  })
})
