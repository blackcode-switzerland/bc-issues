// This app, as the shared request layer sees it.
//
// `AppContext` is the whole of what `@blackcode/platform-api` needs in order to
// serve a route on this app's behalf: who we are in `platform.apps`, how to talk
// to the database, and how to work out who is calling. The shared `apiHandler`,
// `resolveWorkspace` and every platform route factory are bound to this object
// and nothing else.
//
// It is the mount point for the shared routes too:
//
//   import { searchRoute } from '@blackcode/platform-api/routes'
//   import { appContext } from '@/lib/api'
//   export const GET = searchRoute(appContext)
//
// See `packages/platform-api/src/app-context.ts` for the bar a new field has to
// clear before it is added here.

import { getServerSession } from 'next-auth'
import type { AppContext } from '@blackcode/platform-api'
import { db } from '@/lib/db/client'
import { resolveUser } from '@/lib/auth/resolve'
import { authOptions } from '@/lib/auth'
import { getUserByEmail } from '@/lib/db/queries/users'
import { APP_SLUG } from '@/lib/app'
import { AGENT_MANIFEST } from '@/lib/agent-manifest'

/**
 * The browser-session caller, with NO bearer-token path. Feeds `/api/tokens`,
 * where accepting a token would be privilege escalation — see
 * `AppContext.resolveSessionUser`.
 *
 * ── WHY THIS IS NOT `getValidatedSessionUser` ────────────────────────────────
 * `@/lib/auth/session` has a stricter resolver that ALSO rejects soft-deleted
 * users and sessions issued before a password reset, and every other
 * session-authenticated path in this app goes through it. The token routes never
 * did — they inlined exactly the two lines below — so using the stricter one
 * here would quietly change who can manage tokens as a side effect of a
 * refactor. This is a move, so this is what moved.
 *
 * It is very likely the token routes SHOULD use the stricter resolver: a session
 * invalidated by a password reset can still mint a long-lived API token today,
 * and revoking the session does not revoke what it minted. That is a one-word
 * change here and a decision for whoever owns it, not a thing to smuggle in.
 */
async function resolveSessionUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return getUserByEmail(session.user.email)
}

export const appContext: AppContext = {
  appSlug: APP_SLUG,
  db,
  resolveUser,
  resolveSessionUser,
  manifest: {
    help: AGENT_MANIFEST.help,
    changelog: AGENT_MANIFEST.changelog,
  },
  // Absent, deliberately. D-19 item 2 gives `apps/sales` body redaction because
  // it holds names, emails and call notes about people at other companies. This
  // app records issue titles, and its error rows are the only thing that makes a
  // 500 diagnosable. Leaving it off is today's behaviour, unchanged.
}
