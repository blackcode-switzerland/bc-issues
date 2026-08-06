// /api/workspaces
//
// GET is mounted from the shared factory. POST is NOT, and that is a decision
// rather than an omission: `createWorkspace` records events through this app's
// event spine (`recordEvent` → `fanOutEvent`), which is not extracted. It is
// also not needed elsewhere yet — D-3 gives the sales app no create-workspace
// flow, and `bk workspace` is a neutral verb that reaches the home server. When
// the event spine is shared, this file collapses to the GET line alone.

import { NextRequest, NextResponse } from 'next/server'
import { workspacesRoute } from '@blackcode/platform-api/routes'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors, appContext } from '@/lib/api'
import { createWorkspace } from '@/lib/db/queries/workspaces'
import { WORKSPACE_NAME_MAX } from '@/lib/limits'

export const GET = workspacesRoute(appContext)

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()

  const body = await request.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : undefined
  const logo_url = typeof body?.logo_url === 'string' ? body.logo_url : undefined

  if (!name) throw Errors.badRequest('invalid_name', 'name is required')
  if (name.length > WORKSPACE_NAME_MAX)
    throw Errors.badRequest('name_too_long', `name max ${WORKSPACE_NAME_MAX} chars`)

  const ws = await createWorkspace({ name, slug, logo_url, ownerId: user.id })
  return NextResponse.json(ws, { status: 201 })
})
