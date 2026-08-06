// `apiHandler`, bound to this app.
//
// The implementation moved to `@blackcode/platform-api` on 2026-08-06 —
// docs/sales-app-plan.md Phase 1a, decision D-2 — because `apps/sales` is
// deployed on its own domain and needs the identical wrapper. Read that file's
// header for what the shared version keeps and why each of those things is not
// optional (the `platform.error_events` logging, the CLI version headers, and
// the 401/404/403 distinctions in `resolveWorkspace`).
//
// Nothing about this app's behaviour changed. Every `@/lib/api` import site is
// untouched, and the wrapper's signature is the one it always had:
//
//   export const GET = apiHandler(async (req) => {
//     const user = await resolveUser(req)
//     if (!user) throw Errors.unauthorized()
//     return NextResponse.json({ data })
//   })

import { createApiHandler } from '@blackcode/platform-api'
import { appContext } from './context'

export const apiHandler = createApiHandler(appContext)
