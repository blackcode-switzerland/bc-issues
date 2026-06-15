// Full-detail error view. Auth: must be a workspace owner somewhere.
// We don't gate on "owner of the workspace this error belongs to" because
// most errors have NULL workspace_id, and 5xxs we want to diagnose are
// usually internal. Owner-of-any-workspace is the right trust bar.

import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { getErrorEvent } from '@/lib/db/queries/error-events'
import { isWorkspaceOwnerSomewhere } from '@/lib/db/queries/workspaces'

interface Params {
  params: Promise<{ id: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const user = await resolveUser(req)
  if (!user) throw Errors.unauthorized()
  if (!(await isWorkspaceOwnerSomewhere(user.id))) {
    throw Errors.forbidden('Only workspace owners can view error details')
  }
  const { id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')
  const row = await getErrorEvent(id)
  if (!row) throw Errors.notFound('error_event')
  return NextResponse.json(row)
})
