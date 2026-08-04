import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { getWorkspaceForUser, setActiveWorkspace } from '@/lib/db/queries/workspaces'

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }

  let target: string | null = null
  if (typeof body.workspace_id === 'number') target = String(body.workspace_id)
  else if (typeof body.slug === 'string') target = body.slug
  else if (typeof body.workspace === 'string') target = body.workspace
  if (target === null) {
    throw Errors.badRequest(
      'missing_workspace',
      'provide workspace_id (number) or slug (string)'
    )
  }

  const ws = await getWorkspaceForUser(target, user.id)
  if (!ws) throw Errors.notFound('workspace')

  await setActiveWorkspace(user.id, ws.id)
  return NextResponse.json({ active_workspace_id: ws.id, slug: ws.slug })
})
