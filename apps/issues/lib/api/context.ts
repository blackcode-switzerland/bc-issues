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

import type { AppContext } from '@blackcode/platform-api'
import { db } from '@/lib/db/client'
import { resolveUser } from '@/lib/auth/resolve'
import { APP_SLUG } from '@/lib/app'
import { AGENT_MANIFEST } from '@/lib/agent-manifest'

export const appContext: AppContext = {
  appSlug: APP_SLUG,
  db,
  resolveUser,
  manifest: {
    help: AGENT_MANIFEST.help,
    changelog: AGENT_MANIFEST.changelog,
  },
  // Absent, deliberately. D-19 item 2 gives `apps/sales` body redaction because
  // it holds names, emails and call notes about people at other companies. This
  // app records issue titles, and its error rows are the only thing that makes a
  // 500 diagnosable. Leaving it off is today's behaviour, unchanged.
}
