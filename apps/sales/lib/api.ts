// This app, as the shared request layer sees it — plus the two things every
// route imports: `apiHandler` and `resolveWorkspace`.
//
// The implementation lives in `@blackcode/platform-api` (D-2, Phase 1a). What
// this file owns is the `appContext` below; everything else follows from it.
import type { NextRequest } from 'next/server'
import {
  createApiHandler,
  createResolveWorkspace,
  type AppContext,
} from '@blackcode/platform-api'
import { verifyToken } from '@blackcode/platform-auth'
import { getDb } from './db/client'
import { APP_SLUG } from './app'

/**
 * The caller, from a `bk_live_…` bearer token.
 *
 * Token only, for now. The browser half is a NextAuth session and arrives with
 * the web foundation (Phase 6); until then the CLI path — the path agents use —
 * works from the first commit. `resolveSessionUser` stays absent deliberately:
 * the routes that require it fail at MOUNT time rather than silently accepting a
 * bearer token where a session is required.
 */
async function resolveUser(req: NextRequest) {
  const header = req.headers.get('authorization') ?? ''
  if (!header.startsWith('Bearer ')) return null
  return verifyToken(getDb(), header.slice('Bearer '.length).trim())
}

export const appContext: AppContext = {
  appSlug: APP_SLUG,
  // A GETTER, not `db: getDb()`. Calling it here would open a connection at
  // module import time, and `next build` imports every route module to collect
  // page data — so an eager client makes the app unbuildable without a
  // DATABASE_URL. See the header of ./db/client.ts.
  get db() {
    return getDb()
  },
  resolveUser,

  // ── D-19 ITEM 2 — AND READ ITS CEILING BEFORE QUOTING IT ───────────────────
  // Sales holds names, emails, phone numbers and free-text notes about people at
  // OTHER companies. `sanitize()` strips credentials by KEY NAME; it cannot know
  // that `contact_email` or `call_notes` matter. So this app opts out of
  // carrying `ApiError.details` into `platform.error_events.context` entirely,
  // and a `{ redacted: 'body' }` marker distinguishes "withheld" from "there was
  // none".
  //
  // WHAT IT DOES NOT DO, stated here so nobody claims more than it delivers:
  // `message` and `stack` are recorded regardless, and a Postgres driver will
  // put a rejected value straight into an error message ("Key (email)=(…)
  // already exists"). Redacting those was considered and REJECTED — an error row
  // nobody can triage is not a privacy win. **The honest control on message and
  // stack is retention**, D-19 item 1's 90-day horizon, which covers sales error
  // rows too. See docs/sales-app-plan.md §12 and
  // packages/platform-api/src/handler.ts at `errorLogContext`.
  redactBody: true,

  // No `manifest`: sales has no agent landing page yet, and an X-BK-Help header
  // pointing at a 404 is worse than no header. It arrives with Phase 6.
}

export const apiHandler = createApiHandler(appContext)
export const resolveWorkspace = createResolveWorkspace(appContext)

export { requireOwner } from '@blackcode/platform-api'
export type { WorkspaceContext } from '@blackcode/platform-api'
