import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors, jsonList } from '@/lib/api'
import { createWorkspace, listMyWorkspaces } from '@/lib/db/queries/workspaces'
import { WORKSPACE_NAME_MAX } from '@/lib/limits'

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()
  const data = await listMyWorkspaces(user.id)
  return jsonList(data)
})

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
