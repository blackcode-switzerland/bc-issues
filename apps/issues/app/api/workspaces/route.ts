import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors, jsonList } from '@/lib/api'
import { createWorkspace, listMyWorkspaces } from '@/lib/db/queries/workspaces'
import { WORKSPACE_NAME_MAX } from '@/lib/limits'
import { APP_SLUG } from '@/lib/app'
import { db } from '@/lib/db/client'
import { appsReachableByUser } from '@blackcode/platform-db'

// GET /api/workspaces — by default, the workspaces you can use THIS app in.
//
// `?all=1` widens it to every workspace you are a member of, and adds an `apps`
// array per row: which apps you can reach there. That is what `bk workspace list
// --all` renders as per-app badges, and it is the only way to see a workspace
// this app is not enabled in — without it, "where did my workspace go?" has no
// answer from inside the app that hid it.
export const GET = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()

  const all = ['1', 'true', 'yes'].includes(
    (request.nextUrl.searchParams.get('all') ?? '').toLowerCase()
  )

  if (!all) {
    return jsonList(await listMyWorkspaces(user.id, { app: APP_SLUG }))
  }

  const [workspaces, reachable] = await Promise.all([
    listMyWorkspaces(user.id),
    appsReachableByUser(db, user.id),
  ])
  const appsByWorkspace = new Map<number, string[]>()
  for (const app of reachable) {
    for (const wsId of app.workspace_ids) {
      appsByWorkspace.set(wsId, [...(appsByWorkspace.get(wsId) ?? []), app.slug])
    }
  }
  return jsonList(
    workspaces.map((w) => ({ ...w, apps: appsByWorkspace.get(w.id) ?? [] }))
  )
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
