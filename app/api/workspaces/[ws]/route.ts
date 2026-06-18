import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, requireOwner } from '@/lib/api'
import {
  deleteWorkspace,
  listWorkspaceMembers,
  updateWorkspace,
} from '@/lib/db/queries/workspaces'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const members = await listWorkspaceMembers(ctx.workspace.id)
  return NextResponse.json({
    workspace: ctx.workspace,
    role: ctx.role,
    members,
  })
})

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
    if (n.length > 80) throw Errors.badRequest('name_too_long', 'name max 80 chars')
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
