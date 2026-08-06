// The minimum an app needs to serve a route: the error envelope, the auth +
// workspace + app-access check, and the response headers.
//
// ---------------------------------------------------------------------------
// WHY THIS IS DUPLICATED FROM apps/issues AND NOT SHARED
// ---------------------------------------------------------------------------
// `apps/issues/lib/api/{handler,workspace-context}.ts` do the same job, better —
// they also log to `platform.error_events` and carry an agent manifest. They are
// NOT imported here, and could not be: an app may never import from another app
// (docs/platform-architecture.md §7.6, enforced by .eslintrc.json).
//
// They have not been moved to `packages/platform-api` either, and that is a
// deliberate, recorded decision rather than an oversight. Both close over this
// app's `db`, its schema and its `APP_SLUG`, so sharing them means adding three
// parameters — and the standing rule is "if you have to add a parameter to make
// it generic, leave it in the app" (the platform migration, Phase 2 — docs/2026-08-platform-migration.md). That
// rule exists to stop speculative extraction; a scaffold is not the second app
// that justifies paying the cost.
//
// **When a REAL second app lands, extract these two into `platform-api` as its
// first task** — at that point two production apps need them unchanged, which is
// exactly the test. Until then this file is 60 honest lines a new app owns.
import { NextRequest, NextResponse } from 'next/server'
import { ApiError, Errors, errorBody } from '@blackcode/platform-api'
import { CLI_LATEST_VERSION, CLI_MIN_VERSION } from '@blackcode/platform-agent'
import { requireAppAccess, verifyToken } from '@blackcode/platform-auth'
import { sql } from 'drizzle-orm'
import { getDb } from './db/client'
import { workspaces, workspaceMembers } from './db/schema'
import { APP_SLUG } from './app'

export interface WorkspaceContext {
  user: { id: number; email: string }
  workspace: { id: number; slug: string }
  role: string
}

/**
 * The caller, from a `bk_live_…` bearer token.
 *
 * Token only, deliberately. The browser half is a NextAuth session, and NextAuth
 * config is genuinely app-specific (providers, callbacks, cookie domain) — see
 * the note in `packages/platform-auth/src/index.ts` explaining why
 * `apps/issues/lib/auth.ts` stayed put. A new app adds that when it grows a UI;
 * the CLI path works from the first commit, which is the path agents use.
 */
async function resolveUser(req: NextRequest) {
  const header = req.headers.get('authorization') ?? ''
  if (!header.startsWith('Bearer ')) return null
  return verifyToken(getDb(), header.slice('Bearer '.length).trim())
}

/**
 * Wrap a route handler so every thrown error becomes the canonical JSON body,
 * and every response carries the CLI version headers.
 *
 * The headers are not decoration: `bk` reads `x-bk-cli-min` and hard-blocks
 * itself when it is too old (exit 8). An app that omits them is an app whose
 * users can never be told to upgrade.
 */
export function apiHandler<A extends unknown[]>(
  fn: (req: NextRequest, ...args: A) => Promise<Response>
) {
  return async (req: NextRequest, ...args: A): Promise<Response> => {
    try {
      const res = await fn(req, ...args)
      res.headers.set('x-bk-cli-latest', CLI_LATEST_VERSION)
      res.headers.set('x-bk-cli-min', CLI_MIN_VERSION)
      return res
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json(errorBody(err), { status: err.status })
      }
      // Never leak an internal message. A real app also records this to
      // `platform.error_events` — see apps/issues/lib/api/handler.ts.
      console.error('[template] unhandled error:', err)
      return NextResponse.json(
        { error: 'Internal server error', code: 'internal_error' },
        { status: 500 }
      )
    }
  }
}

/**
 * Authenticate, resolve the workspace, and check that this user may use THIS APP
 * in it.
 *
 * The app-access check is the part a new app forgets. Membership of a workspace
 * is not permission to use every app in it (`platform.app_access`, Phase 4), and
 * an app that only checks membership silently grants itself to everyone.
 */
export async function resolveWorkspace(
  req: NextRequest,
  slugOrId: string
): Promise<WorkspaceContext> {
  const user = await resolveUser(req)
  if (!user) throw Errors.unauthorized()

  // Membership AND the workspace in one query, by slug or id. Scoped to this
  // user: a workspace they are not in must 404, not 403 — a 403 confirms it
  // exists.
  const res = await getDb().execute(sql`
    SELECT w.id, w.slug, m.role
    FROM ${workspaces} w
    JOIN ${workspaceMembers} m ON m.workspace_id = w.id AND m.user_id = ${user.id}
    WHERE (w.slug = ${slugOrId} OR w.id::text = ${slugOrId}) AND w.deleted_at IS NULL
    LIMIT 1
  `)
  const row = res.rows[0] as { id: number; slug: string; role: string } | undefined
  if (!row) throw Errors.notFound('workspace')

  await requireAppAccess(getDb(), {
    workspaceId: Number(row.id),
    userId: user.id,
    userEmail: user.email,
    workspaceSlug: row.slug,
    app: APP_SLUG,
  })

  return {
    user: { id: user.id, email: user.email },
    workspace: { id: Number(row.id), slug: row.slug },
    role: String(row.role),
  }
}
