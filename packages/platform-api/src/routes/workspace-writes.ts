// The workspace-scoped WRITE routes: membership, invitations, per-app access.
//
// ---------------------------------------------------------------------------
// THESE WERE THE LAST THING BLOCKING TIER 1
// ---------------------------------------------------------------------------
// Their reads became factories on 2026-08-06 and their writes did not, for one
// reason: every one records an event, and the only recorder was an app's. D-23
// cut that seam (`recordPlatformEvent`), and these are what it was cut for.
//
// Nothing here is Class B. The app-specific part of each was always the same
// thing — which app is writing — and that is `AppContext.appSlug`, not a
// contribution. The one exception is the invitations POST, which has to put a
// link in an email; that lives in `./invitations.ts` because it IS Class B.
//
// ---------------------------------------------------------------------------
// `ctx.appSlug` DOES TWO DIFFERENT JOBS IN THIS FILE. DO NOT MERGE THEM.
// ---------------------------------------------------------------------------
//   1. the PRODUCING app on every event row (`WriteContext.app`)
//   2. in `workspaceAppRoute`, the app you are FORBIDDEN to disable, because
//      disabling the app serving the request locks the workspace out of it with
//      no way back — including out of this very route, which is behind the
//      access check that just went away
//
// The second is the reason that check reads `ctx.appSlug` rather than a
// constant: hardcoded, it would protect issues from being disabled through the
// sales host and let sales disable itself through its own.

import { NextRequest, NextResponse } from 'next/server'
import {
  DEFAULT_ACCESS_MODES,
  disableAppForWorkspace,
  enableAppForWorkspace,
  getMembership,
  getWorkspaceApp,
  grantAppAccess,
  listAppAccessMembers,
  recordPlatformEvent,
  removeMember,
  revokeAppAccess,
  revokeInvitation,
  setDefaultAccess,
  type DefaultAccessMode,
} from '@blackcode/platform-db'
import type { AppContext } from '../app-context'
import { Errors } from '../errors'
import { createApiHandler, createResolveWorkspace, requireOwner } from '../handler'
import { jsonList } from '../responses'

interface WsUserParams {
  params: Promise<{ ws: string; userId: string }>
}
interface WsIdParams {
  params: Promise<{ ws: string; id: string }>
}
interface WsAppParams {
  params: Promise<{ ws: string; app: string }>
}
interface WsAppUserParams {
  params: Promise<{ ws: string; app: string; userId: string }>
}

function isMode(v: unknown): v is DefaultAccessMode {
  return typeof v === 'string' && (DEFAULT_ACCESS_MODES as readonly string[]).includes(v)
}

/** `DELETE /api/workspaces/{ws}/members/{userId}` — remove a member. Owner only. */
export function workspaceMemberRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)
  const resolveWorkspace = createResolveWorkspace(app)

  const DELETE = apiHandler(async (req: NextRequest, { params }: WsUserParams) => {
    const { ws, userId: userIdRaw } = await params
    const targetId = parseInt(userIdRaw)
    if (Number.isNaN(targetId)) {
      throw Errors.badRequest('invalid_user_id', 'userId must be an integer')
    }

    const ctx = await resolveWorkspace(req, ws)
    requireOwner(ctx)

    if (targetId === ctx.workspace.owner_id) {
      throw Errors.badRequest(
        'cannot_remove_owner',
        'Transfer ownership before removing the owner'
      )
    }

    const ok = await removeMember(
      { db: app.db, app: app.appSlug },
      ctx.workspace.id,
      targetId,
      ctx.user.id
    )
    if (!ok) throw Errors.notFound('member')
    return NextResponse.json({ removed: true })
  })

  return { DELETE }
}

/** `DELETE /api/workspaces/{ws}/invitations/{id}` — revoke a pending invite. */
export function workspaceInvitationRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)
  const resolveWorkspace = createResolveWorkspace(app)

  const DELETE = apiHandler(async (req: NextRequest, { params }: WsIdParams) => {
    const { ws, id: idRaw } = await params
    const id = parseInt(idRaw)
    if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')

    const ctx = await resolveWorkspace(req, ws)
    requireOwner(ctx)

    const ok = await revokeInvitation(
      { db: app.db, app: app.appSlug },
      id,
      ctx.workspace.id,
      ctx.user.id
    )
    if (!ok) throw Errors.notFound('invitation')
    return NextResponse.json({ revoked: true })
  })

  return { DELETE }
}

/**
 * `PATCH /api/workspaces/{ws}/apps/{app}` — enable/disable an app for this
 * workspace, and choose how it hands out access. Owner only.
 *
 * Body: `{ enabled?: boolean, default_access?: 'all_members' | 'invite_only' }`
 *
 * ── WHY YOU CANNOT DISABLE THE APP YOU ARE CALLING FROM ─────────────────────
 * Disabling an app for a workspace revokes every member's access to it. Doing
 * that to the app serving the request locks the whole team out of the product —
 * including the owner, including this very route, since it is workspace-scoped
 * and therefore behind the access check that just went away. It would be an
 * irreversible action reachable by one toggle, with no way back from inside the
 * product.
 *
 * `--confirm`-style repetition would not fix it either; the problem is not that
 * the owner might not mean it, the problem is that there is no undo. So the
 * route refuses, with a suggestion naming the two ways out. The toggle is still
 * real for every other app — which is the case it exists for.
 */
export function workspaceAppRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)
  const resolveWorkspace = createResolveWorkspace(app)

  const PATCH = apiHandler(async (req: NextRequest, { params }: WsAppParams) => {
    const { ws, app: target } = await params
    const ctx = await resolveWorkspace(req, ws)
    requireOwner(ctx)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      throw Errors.badRequest('invalid_body', 'expected JSON object')
    }
    if (!('enabled' in body) && !('default_access' in body)) {
      throw Errors.badRequest(
        'nothing_to_update',
        'pass `enabled` and/or `default_access`',
        'e.g. bk app default-access issues --mode invite_only'
      )
    }

    if ('default_access' in body && !isMode(body.default_access)) {
      throw Errors.badRequest(
        'invalid_default_access',
        `default_access must be one of: ${DEFAULT_ACCESS_MODES.join(', ')}`,
        'Run `bk app list` to see the current mode for each app.'
      )
    }

    let enabled: boolean | undefined
    if ('enabled' in body) {
      if (typeof body.enabled !== 'boolean') {
        throw Errors.badRequest('invalid_enabled', 'enabled must be a boolean')
      }
      enabled = body.enabled
    }

    // `app.appSlug`, not a constant — see the header. Hardcoded, this would
    // protect one app from being disabled through the wrong host and let another
    // disable itself through its own.
    if (enabled === false && target === app.appSlug) {
      throw Errors.badRequest(
        'cannot_disable_current_app',
        `You cannot disable ${target} from within ${target} — it would lock every member of this workspace out of it, including you, with no way back.`,
        'Delete the workspace if that is what you mean, or disable this app from another app in the suite.'
      )
    }

    await app.db.transaction(async (tx) => {
      if (enabled === false) {
        const removed = await disableAppForWorkspace(tx, ctx.workspace.id, target)
        if (!removed) throw Errors.notFound('workspace_app')
        await recordPlatformEvent(tx, {
          app: app.appSlug,
          workspaceId: ctx.workspace.id,
          actorUserId: ctx.user.id,
          entityType: 'workspace_app',
          entityId: ctx.workspace.id,
          action: 'app_disabled',
          meta: { app: target },
        })
        return
      }

      if (enabled === true) {
        await enableAppForWorkspace(tx, {
          workspaceId: ctx.workspace.id,
          app: target,
          enabledBy: ctx.user.id,
          defaultAccess: isMode(body.default_access) ? body.default_access : undefined,
        })
        await recordPlatformEvent(tx, {
          app: app.appSlug,
          workspaceId: ctx.workspace.id,
          actorUserId: ctx.user.id,
          entityType: 'workspace_app',
          entityId: ctx.workspace.id,
          action: 'app_enabled',
          meta: { app: target, default_access: body.default_access ?? 'all_members' },
        })
        return
      }

      // default_access only — the app must already be on here.
      const mode = body.default_access as DefaultAccessMode
      const ok = await setDefaultAccess(tx, ctx.workspace.id, target, mode, ctx.user.id)
      if (!ok) {
        throw Errors.notFound('workspace_app')
      }
      await recordPlatformEvent(tx, {
        app: app.appSlug,
        workspaceId: ctx.workspace.id,
        actorUserId: ctx.user.id,
        entityType: 'workspace_app',
        entityId: ctx.workspace.id,
        action: 'app_default_access_changed',
        meta: { app: target, default_access: mode },
      })
    })

    const current = await getWorkspaceApp(app.db, ctx.workspace.id, target)
    return NextResponse.json({
      app: target,
      enabled: current !== null,
      default_access: current?.default_access ?? null,
    })
  })

  return { PATCH }
}

/**
 * Per-member access to one app.
 *
 *   GET  — every member of the workspace, flagged with whether they hold access.
 *          Readable by any member: "why can Ana see this and I can't" should be
 *          answerable without asking an owner.
 *   POST — grant access to one member. Owner only. Body: `{ user_id }`
 *
 * Revoking is `workspaceAppAccessMemberRoute` below.
 */
export function workspaceAppAccessRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)
  const resolveWorkspace = createResolveWorkspace(app)

  const GET = apiHandler(async (req: NextRequest, { params }: WsAppParams) => {
    const { ws, app: target } = await params
    const ctx = await resolveWorkspace(req, ws)
    return jsonList(await listAppAccessMembers(app.db, ctx.workspace.id, target))
  })

  const POST = apiHandler(async (req: NextRequest, { params }: WsAppParams) => {
    const { ws, app: target } = await params
    const ctx = await resolveWorkspace(req, ws)
    requireOwner(ctx)

    const body = await req.json().catch(() => null)
    const userId = typeof body?.user_id === 'number' ? body.user_id : NaN
    if (!Number.isInteger(userId)) {
      throw Errors.badRequest(
        'invalid_user_id',
        'user_id (integer) is required',
        'Run `bk member list` to see user ids in this workspace.'
      )
    }

    // The app must be on here, or a grant would be a row nothing honours.
    const wsApp = await getWorkspaceApp(app.db, ctx.workspace.id, target)
    if (!wsApp) {
      throw Errors.badRequest(
        'app_not_enabled',
        `The ${target} app is not enabled for this workspace.`,
        `Enable it first: bk app enable ${target} --ws ${ctx.workspace.slug}`
      )
    }

    // Access requires membership — the app_access FK enforces that too, but a
    // 409 saying so beats a raw FK violation.
    const membership = await getMembership(app.db, ctx.workspace.id, userId)
    if (!membership) {
      throw Errors.conflict(
        'not_a_member',
        'That user is not a member of this workspace.',
        `Invite them first: bk invite create --email <email> --app ${target}`
      )
    }

    await app.db.transaction(async (tx) => {
      await grantAppAccess(
        tx,
        { app: target, workspaceId: ctx.workspace.id, userId },
        { role: membership.role, grantedBy: ctx.user.id }
      )
      await recordPlatformEvent(tx, {
        app: app.appSlug,
        workspaceId: ctx.workspace.id,
        actorUserId: ctx.user.id,
        entityType: 'workspace_app',
        entityId: ctx.workspace.id,
        action: 'app_access_granted',
        meta: { app: target, user_id: userId },
      })
    })

    return NextResponse.json({ app: target, user_id: userId, granted: true }, { status: 201 })
  })

  return { GET, POST }
}

/**
 * `DELETE /api/workspaces/{ws}/apps/{app}/access/{userId}` — revoke one member's
 * access to one app. Owner only.
 *
 * Refuses to revoke the workspace OWNER's access, for the same reason
 * `cannot_remove_owner` exists on member removal: the owner is the only person
 * who can grant it back, and this route is behind the very access check being
 * removed.
 */
export function workspaceAppAccessMemberRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)
  const resolveWorkspace = createResolveWorkspace(app)

  const DELETE = apiHandler(async (req: NextRequest, { params }: WsAppUserParams) => {
    const { ws, app: target, userId: userIdRaw } = await params
    const targetId = parseInt(userIdRaw)
    if (Number.isNaN(targetId)) {
      throw Errors.badRequest('invalid_user_id', 'userId must be an integer')
    }

    const ctx = await resolveWorkspace(req, ws)
    requireOwner(ctx)

    if (targetId === ctx.workspace.owner_id) {
      throw Errors.badRequest(
        'cannot_revoke_owner',
        'The workspace owner cannot have their app access revoked — nobody else could grant it back.',
        'Transfer ownership first with `bk workspace transfer`, then revoke.'
      )
    }

    const revoked = await app.db.transaction(async (tx) => {
      const ok = await revokeAppAccess(tx, {
        app: target,
        workspaceId: ctx.workspace.id,
        userId: targetId,
      })
      if (ok) {
        await recordPlatformEvent(tx, {
          app: app.appSlug,
          workspaceId: ctx.workspace.id,
          actorUserId: ctx.user.id,
          entityType: 'workspace_app',
          entityId: ctx.workspace.id,
          action: 'app_access_revoked',
          meta: { app: target, user_id: targetId },
        })
      }
      return ok
    })

    if (!revoked) throw Errors.notFound('app_access')
    return NextResponse.json({ deleted: true })
  })

  return { DELETE }
}
