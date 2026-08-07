import { NextRequest, NextResponse } from 'next/server'
import { workspaceShowRoute } from '@blackcode/platform-api/routes'
import { apiHandler, Errors, resolveWorkspace, requireOwner, appContext } from '@/lib/api'
import { deleteWorkspace, updateWorkspace } from '@/lib/db/queries/workspaces'
import { WORKSPACE_NAME_MAX } from '@/lib/limits'

interface Params {
  params: Promise<{ ws: string }>
}

// GET is the shared factory as of 2026-08-07 — it touches only platform data
// (resolveWorkspace + listWorkspaceMembers), while PATCH and DELETE below call
// app-local writes with a cascade. `bk workspace use` resolves a slug through
// this route before saving it, so an app that could not serve it had a CLI able
// to list workspaces and not select one.
export const GET = workspaceShowRoute(appContext)

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }

  const patch: { name?: string; slug?: string; logo_url?: string | null } = {}
  if ('name' in body) {
    if (typeof body.name !== 'string') throw Errors.badRequest('invalid_name', 'name must be a string')
    const n = body.name.trim()
    if (!n) throw Errors.badRequest('invalid_name', 'name cannot be empty')
    if (n.length > WORKSPACE_NAME_MAX)
      throw Errors.badRequest('name_too_long', `name max ${WORKSPACE_NAME_MAX} chars`)
    patch.name = n
  }
  if ('slug' in body) {
    if (typeof body.slug !== 'string') throw Errors.badRequest('invalid_slug', 'slug must be a string')
    patch.slug = body.slug.trim()
  }
  if ('logo_url' in body) {
    if (body.logo_url !== null && typeof body.logo_url !== 'string') {
      throw Errors.badRequest('invalid_logo_url', 'logo_url must be a string or null')
    }
    patch.logo_url = body.logo_url
  }

  const updated = await updateWorkspace(ctx.workspace.id, patch, ctx.user.id)
  if (!updated) throw Errors.notFound('workspace')
  return NextResponse.json(updated)
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)
  await deleteWorkspace(ctx.workspace.id)
  return NextResponse.json({ deleted: true })
})
