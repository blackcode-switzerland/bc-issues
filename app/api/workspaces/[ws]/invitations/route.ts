import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, requireOwner } from '@/lib/api'
import {
  createInvitation,
  listWorkspaceInvitations,
} from '@/lib/db/queries/invitations'
import { sendInvitationEmail } from '@/lib/email/send'
import { isEmailAllowed, isSuperAdmin, isWhitelistEnabled } from '@/lib/auth/whitelist'
import { addWhitelistEntry } from '@/lib/db/queries/whitelist'

interface Params {
  params: Promise<{ ws: string }>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INVITE_TTL_DAYS = 14

function baseUrl(req: NextRequest): string {
  const fromEnv = process.env.NEXTAUTH_URL
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  try {
    return new URL(req.url).origin
  } catch {
    return ''
  }
}

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
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !EMAIL_RE.test(email)) {
    throw Errors.badRequest('invalid_email', 'email is required and must be a valid email')
  }
  if (email.length > 255) {
    throw Errors.badRequest('email_too_long', 'email max 255 chars')
  }

  // Whitelist gate for invitations
  if (isWhitelistEnabled()) {
    const allowed = await isEmailAllowed(email)
    if (!allowed) {
      if (isSuperAdmin(ctx.user.email)) {
        // Super admins can invite anyone — auto-add the email to the whitelist
        await addWhitelistEntry({ type: 'email', value: email, added_by: ctx.user.id })
      } else {
        throw Errors.forbidden(
          `${email} is not in the approved list. Only Blackcode team members can be invited. Contact a super admin to add them first.`
        )
      }
    }
  }

  try {
    const result = await createInvitation({
      workspaceId: ctx.workspace.id,
      email,
      invitedBy: ctx.user.id,
      ttlDays: INVITE_TTL_DAYS,
    })

    // Send the invitation email AFTER the invite is committed. Best-effort —
    // a bounced email never invalidates the invitation, which is also
    // available in-app (inbox) and via the copyable accept link.
    const acceptUrl = `${baseUrl(req)}/invitations/${result.invitation.token}`
    const emailResult = await sendInvitationEmail(email, {
      workspaceName: ctx.workspace.name,
      inviterName: ctx.user.name ?? ctx.user.email,
      acceptUrl,
      inviteeHasAccount: result.invitee_has_account,
      expiresInDays: INVITE_TTL_DAYS,
    })

    return NextResponse.json(
      {
        invitation: result.invitation,
        invitee_has_account: result.invitee_has_account,
        email_sent: emailResult.sent,
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
