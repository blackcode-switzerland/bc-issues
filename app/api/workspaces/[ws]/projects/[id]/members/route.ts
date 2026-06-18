// Workspace-scoped project members: list / add / remove.
//
// Canonical replacement for legacy /api/projects/[id]/members. Unlike the legacy
// route (which only checked project role and never workspace membership), this
// gates on workspace membership via resolveWorkspace and verifies the project
// belongs to the resolved workspace, then preserves the project-role RBAC
// (owner/admin may add/remove members).

import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, jsonList } from '@/lib/api'
import {
  getProjectMembers,
  addProjectMember,
  removeProjectMember,
  getProjectMemberRole,
  getUserByEmail,
} from '@/lib/db'
import { getProjectInWorkspace } from '@/lib/db/queries/projects'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

const VALID_ROLES = ['owner', 'admin', 'member', 'viewer']

async function resolveProject(ws: string, idStr: string, req: NextRequest) {
  const projectId = parseInt(idStr)
  if (Number.isNaN(projectId)) throw Errors.badRequest('invalid_id', 'project id must be an integer')
  const ctx = await resolveWorkspace(req, ws)
  const project = await getProjectInWorkspace(ctx.workspace.id, projectId)
  if (!project) throw Errors.notFound('project')
  return { ctx, projectId }
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id } = await params
  const { projectId } = await resolveProject(ws, id, req)
  const members = await getProjectMembers(projectId)
  return jsonList(members)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id } = await params
  const { ctx, projectId } = await resolveProject(ws, id, req)

  const role = await getProjectMemberRole(projectId, ctx.user.id)
  if (!role || !['owner', 'admin'].includes(role)) {
    throw Errors.forbidden('Only project owners and admins can add members')
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (!email) throw Errors.badRequest('invalid_email', 'email is required')

  const newRole = body.role ?? 'member'
  if (!VALID_ROLES.includes(newRole)) {
    throw Errors.badRequest('invalid_role', `Valid roles: ${VALID_ROLES.join(', ')}`)
  }

  const target = await getUserByEmail(email)
  if (!target) {
    throw Errors.notFound('user')
  }

  const member = await addProjectMember(projectId, target.id, newRole)
  return NextResponse.json(
    { ...member, name: target.name, email: target.email, avatar_url: target.avatar_url },
    { status: 201 }
  )
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id } = await params
  const { ctx, projectId } = await resolveProject(ws, id, req)

  const role = await getProjectMemberRole(projectId, ctx.user.id)
  if (!role || !['owner', 'admin'].includes(role)) {
    throw Errors.forbidden('Only project owners and admins can remove members')
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }
  const userId = body.user_id
  if (typeof userId !== 'number') {
    throw Errors.badRequest('invalid_user_id', 'user_id is required and must be an integer')
  }

  // Only an owner can remove another owner.
  const targetRole = await getProjectMemberRole(projectId, userId)
  if (targetRole === 'owner' && role !== 'owner') {
    throw Errors.forbidden('Only project owners can remove other owners')
  }

  await removeProjectMember(projectId, userId)
  return NextResponse.json({ deleted: true })
})
