// PATCH /api/workspaces/{ws}/apps/{app} — enable/disable an app for this
// workspace, and choose how it hands out access. Owner only.
//
// Body: { enabled?: boolean, default_access?: 'all_members' | 'invite_only' }
//
// ---------------------------------------------------------------------------
// WHY YOU CANNOT DISABLE THE APP YOU ARE CALLING FROM
// ---------------------------------------------------------------------------
// Disabling an app for a workspace revokes every member's access to it. Doing
// that to the app serving the request locks the whole team out of the product —
// including the owner, including this very route, since it is workspace-scoped
// and therefore behind the access check that just went away. It would be an
// irreversible action reachable by one toggle, with no way back from inside the
// product.
//
// `--confirm`-style repetition would not fix it either; the problem is not that
// the owner might not mean it, the problem is that there is no undo. So the route
// refuses, with a suggestion naming the two ways out. The toggle is still real for
// every other app — which is the case it exists for.

import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, requireOwner } from '@/lib/api'
import { db } from '@/lib/db/client'
import { APP_SLUG } from '@/lib/app'
import { recordEvent } from '@/lib/db/queries/events'
import {
  DEFAULT_ACCESS_MODES,
  disableAppForWorkspace,
  enableAppForWorkspace,
  getWorkspaceApp,
  setDefaultAccess,
  type DefaultAccessMode,
} from '@blackcode/platform-db'

interface Params {
  params: Promise<{ ws: string; app: string }>
}

function isMode(v: unknown): v is DefaultAccessMode {
  return typeof v === 'string' && (DEFAULT_ACCESS_MODES as readonly string[]).includes(v)
}

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, app } = await params
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
      "e.g. bk app default-access issues --mode invite_only"
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

  if (enabled === false && app === APP_SLUG) {
    throw Errors.badRequest(
      'cannot_disable_current_app',
      `You cannot disable ${app} from within ${app} — it would lock every member of this workspace out of it, including you, with no way back.`,
      'Delete the workspace if that is what you mean, or disable this app from another app in the suite.'
    )
  }

  await db.transaction(async (tx) => {
    if (enabled === false) {
      const removed = await disableAppForWorkspace(tx, ctx.workspace.id, app)
      if (!removed) throw Errors.notFound('workspace_app')
      await recordEvent(tx, {
        workspaceId: ctx.workspace.id,
        actorUserId: ctx.user.id,
        entityType: 'workspace_app',
        entityId: ctx.workspace.id,
        action: 'app_disabled',
        meta: { app },
      })
      return
    }

    if (enabled === true) {
      await enableAppForWorkspace(tx, {
        workspaceId: ctx.workspace.id,
        app,
        enabledBy: ctx.user.id,
        defaultAccess: isMode(body.default_access) ? body.default_access : undefined,
      })
      await recordEvent(tx, {
        workspaceId: ctx.workspace.id,
        actorUserId: ctx.user.id,
        entityType: 'workspace_app',
        entityId: ctx.workspace.id,
        action: 'app_enabled',
        meta: { app, default_access: body.default_access ?? 'all_members' },
      })
      return
    }

    // default_access only — the app must already be on here.
    const mode = body.default_access as DefaultAccessMode
    const ok = await setDefaultAccess(tx, ctx.workspace.id, app, mode, ctx.user.id)
    if (!ok) {
      throw Errors.notFound('workspace_app')
    }
    await recordEvent(tx, {
      workspaceId: ctx.workspace.id,
      actorUserId: ctx.user.id,
      entityType: 'workspace_app',
      entityId: ctx.workspace.id,
      action: 'app_default_access_changed',
      meta: { app, default_access: mode },
    })
  })

  const current = await getWorkspaceApp(db, ctx.workspace.id, app)
  return NextResponse.json({
    app,
    enabled: current !== null,
    default_access: current?.default_access ?? null,
  })
})
