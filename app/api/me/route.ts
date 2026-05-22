import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import {
  deleteAccountReport,
  getUserById,
  softDeleteUser,
  updateUserProfile,
} from '@/lib/db/queries/users'

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()
  const fresh = await getUserById(user.id)
  if (!fresh) throw Errors.notFound('user')
  return NextResponse.json({
    id: fresh.id,
    email: fresh.email,
    name: fresh.name,
    tagline: fresh.tagline,
    avatar_url: fresh.avatar_url,
    active_workspace_id: fresh.active_workspace_id,
    created_at: fresh.created_at,
  })
})

export const PATCH = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }

  const patch: { name?: string | null; tagline?: string | null; avatar_url?: string | null } = {}

  if ('name' in body) {
    if (body.name !== null && typeof body.name !== 'string') {
      throw Errors.badRequest('invalid_name', 'name must be a string or null')
    }
    const trimmed = typeof body.name === 'string' ? body.name.trim() : body.name
    if (typeof trimmed === 'string' && trimmed.length > 255) {
      throw Errors.badRequest('name_too_long', 'name max 255 chars')
    }
    patch.name = trimmed
  }
  if ('tagline' in body) {
    if (body.tagline !== null && typeof body.tagline !== 'string') {
      throw Errors.badRequest('invalid_tagline', 'tagline must be a string or null')
    }
    const trimmed = typeof body.tagline === 'string' ? body.tagline.trim() : body.tagline
    if (typeof trimmed === 'string' && trimmed.length > 140) {
      throw Errors.badRequest('tagline_too_long', 'tagline max 140 chars')
    }
    patch.tagline = trimmed
  }
  if ('avatar_url' in body) {
    if (body.avatar_url !== null && typeof body.avatar_url !== 'string') {
      throw Errors.badRequest('invalid_avatar_url', 'avatar_url must be a string or null')
    }
    patch.avatar_url = body.avatar_url
  }

  const updated = await updateUserProfile(user.id, patch)
  if (!updated) throw Errors.notFound('user')
  return NextResponse.json({
    id: updated.id,
    email: updated.email,
    name: updated.name,
    tagline: updated.tagline,
    avatar_url: updated.avatar_url,
    active_workspace_id: updated.active_workspace_id,
  })
})

export const DELETE = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()

  // Dry-run: report what would happen.
  const url = new URL(request.url)
  const report = await deleteAccountReport(user.id)
  if (url.searchParams.get('dry_run') === 'true') {
    return NextResponse.json(report)
  }
  if (report.blocked_by.length > 0) {
    throw Errors.conflict(
      'owner_with_members',
      'You must transfer ownership of these workspaces before deleting your account',
      report.blocked_by
    )
  }
  await softDeleteUser(user.id)
  return NextResponse.json({ deleted: true, hard_deleted_workspaces: report.will_hard_delete })
})
