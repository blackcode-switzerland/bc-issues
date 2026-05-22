import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, requireOwner } from '@/lib/api'
import {
  createInvitation,
  listWorkspaceInvitations,
} from '@/lib/db/queries/invitations'

interface Params {
  params: Promise<{ ws: string }>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)
  const includeAll = req.nextUrl.searchParams.get('all') === 'true'
  const data = await listWorkspaceInvitations(ctx.workspace.id, {
    includeNonPending: includeAll,
  })
  return NextResponse.json({ data })
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  const body = await req.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  if (!email || !EMAIL_RE.test(email)) {
    throw Errors.badRequest('invalid_email', 'email is required and must be a valid email')
  }
  if (email.length > 255) {
    throw Errors.badRequest('email_too_long', 'email max 255 chars')
  }

  try {
    const result = await createInvitation({
      workspaceId: ctx.workspace.id,
      email,
      invitedBy: ctx.user.id,
    })
    return NextResponse.json(
      {
        invitation: result.invitation,
        invitee_has_account: result.invitee_has_account,
      },
      { status: 201 }
    )
  } catch (err) {
    const m = (err as Error)?.message
    if (m === 'already_member') {
      throw Errors.conflict(
        'already_member',
        'A user with this email is already a member of the workspace'
      )
    }
    if (m === 'invalid_email') {
      throw Errors.badRequest('invalid_email', 'email is invalid')
    }
    throw err
  }
})
