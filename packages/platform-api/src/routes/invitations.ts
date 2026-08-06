// GET/POST /api/workspaces/{ws}/invitations — inviting somebody to a workspace.
//
// ---------------------------------------------------------------------------
// CLASS B, AND THE CONTRIBUTION IS THE EMAIL (D-22)
// ---------------------------------------------------------------------------
// An invitation is platform: it is to a WORKSPACE, not to an app, and accepting
// one grants whatever each enabled app hands out by default. So the row, the
// token, the whitelist gate and the event all belong here.
//
// What does not is the message. It carries an app's name, its from-address and
// its branding, and there is no such thing as a platform-branded email — a
// person invited from the sales deployment must not receive "Blackcode Issues
// invited you". So the sender arrives as a named second argument.
//
// ---------------------------------------------------------------------------
// THE ACCEPT LINK IS `<this app's origin>/invitations/{token}`
// ---------------------------------------------------------------------------
// A convention, and an app mounting this route must serve that page. It is built
// from the SERVING app's own origin, which is the behaviour you want: the person
// lands back in the deployment that invited them, signs in there, and the
// invitation is accepted through that app's session.
//
// It is a convention rather than a second contribution on purpose. Adding a knob
// for a path no app has wanted a different value for is the "parameter added to
// make it generic" case. The day one does, it becomes a contribution then — and
// `bk invite accept <token>` works from any app regardless, because the token is
// what identifies the invitation.
//
// The email is sent AFTER the invite is committed, and a failure to send never
// invalidates it: the invitation is also in the invitee's inbox and reachable
// from a copyable link.

import { NextRequest, NextResponse } from 'next/server'
import {
  createInvitation,
  getWorkspaceApp,
  listWorkspaceInvitations,
} from '@blackcode/platform-db'
import {
  addWhitelistEntry,
  isEmailAllowed,
  isSuperAdmin,
  isWhitelistEnabled,
} from '@blackcode/platform-auth'
import type { AppContext } from '../app-context'
import { Errors } from '../errors'
import { createApiHandler, createResolveWorkspace, requireOwner } from '../handler'
import { INVITE_EMAIL_MAX } from '../limits'

interface Params {
  params: Promise<{ ws: string }>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INVITE_TTL_DAYS = 14

/** What only the app can do: put an invitation in front of a person. */
export interface InvitationSender {
  /**
   * Send the invitation. MUST NOT throw — a bounced email never invalidates an
   * invitation, which is also in the invitee's inbox and behind a copyable link.
   */
  sendInvitationEmail(
    to: string,
    input: {
      workspaceName: string
      inviterName: string
      acceptUrl: string
      inviteeHasAccount: boolean
      expiresInDays: number
    }
  ): Promise<{ sent: boolean }>
}

/**
 * This deployment's own origin.
 *
 * `NEXTAUTH_URL` first, because behind a proxy the request URL can be the
 * internal one, and a link into an internal hostname is a link nobody outside
 * can open.
 */
function baseUrl(req: NextRequest): string {
  const fromEnv = process.env.NEXTAUTH_URL
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  try {
    return new URL(req.url).origin
  } catch {
    return ''
  }
}

export function workspaceInvitationsRoute(app: AppContext, contribution: InvitationSender) {
  const apiHandler = createApiHandler(app)
  const resolveWorkspace = createResolveWorkspace(app)

  const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
    const { ws } = await params
    const ctx = await resolveWorkspace(req, ws)
    requireOwner(ctx)
    const includeAll = req.nextUrl.searchParams.get('all') === 'true'
    const data = await listWorkspaceInvitations(app.db, ctx.workspace.id, {
      includeNonPending: includeAll,
    })
    return NextResponse.json({ data })
  })

  const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
    const { ws } = await params
    const ctx = await resolveWorkspace(req, ws)
    requireOwner(ctx)

    const body = await req.json().catch(() => null)
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!email || !EMAIL_RE.test(email)) {
      throw Errors.badRequest('invalid_email', 'email is required and must be a valid email')
    }
    if (email.length > INVITE_EMAIL_MAX) {
      throw Errors.badRequest('email_too_long', `email max ${INVITE_EMAIL_MAX} chars`)
    }

    // Whitelist gate for invitations.
    if (isWhitelistEnabled()) {
      const allowed = await isEmailAllowed(app.db, email)
      if (!allowed) {
        if (isSuperAdmin(ctx.user.email)) {
          // Super admins can invite anyone — auto-add the email to the whitelist.
          await addWhitelistEntry(app.db, { type: 'email', value: email, added_by: ctx.user.id })
        } else {
          throw Errors.forbidden(
            `${email} is not in the approved list. Only Blackcode team members can be invited. Contact a super admin to add them first.`
          )
        }
      }
    }

    // Optional: invite straight into one app (Phase 4). Omitted means an
    // org-level invite, where accepting grants whatever the workspace's apps
    // hand out by default. Naming an app also grants that app even where it is
    // 'invite_only' — the invitation IS the grant, which is what makes
    // invite_only usable.
    let target: string | null = null
    if (body?.app !== undefined && body?.app !== null) {
      if (typeof body.app !== 'string' || !body.app.trim()) {
        throw Errors.badRequest('invalid_app', 'app must be a non-empty string')
      }
      // A separate `const` rather than reusing `target`: `body` is `any`, so
      // assigning through it does not narrow `string | null`.
      const requested: string = body.app.trim()
      target = requested
      const known = await getWorkspaceApp(app.db, ctx.workspace.id, requested)
      if (!known) {
        throw Errors.badRequest(
          'app_not_enabled',
          `The ${target} app is not enabled for this workspace, so an invitation into it would grant nothing.`,
          `Run \`bk app list --ws ${ctx.workspace.slug}\` to see which apps are on here.`
        )
      }
    }

    try {
      const result = await createInvitation(
        // `app.appSlug` is the PRODUCING app on the event row. `app: target` is
        // where the invitee is being invited TO. Two different questions.
        { db: app.db, app: app.appSlug },
        {
          workspaceId: ctx.workspace.id,
          email,
          invitedBy: ctx.user.id,
          ttlDays: INVITE_TTL_DAYS,
          app: target,
        }
      )

      const acceptUrl = `${baseUrl(req)}/invitations/${result.invitation.token}`
      const emailResult = await contribution.sendInvitationEmail(email, {
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
      // `createInvitation` throws bare Errors — this package decides what a
      // denial looks like, platform-db does not.
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

  return { GET, POST }
}
