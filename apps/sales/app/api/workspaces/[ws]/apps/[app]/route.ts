// PATCH /api/workspaces/{ws}/apps/{app} — `bk app enable | disable`.
//
// The factory refuses to disable the app that is SERVING the request
// (`cannot_disable_current_app`), so mounting it here means sales can enable or
// disable issues but not itself, and vice versa. That asymmetry is D-27 item 1
// and it is the point: `ctx.appSlug` is both the producing app on the event row
// and the app you may not turn off.
import { workspaceAppRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = workspaceAppRoute(appContext)
export const PATCH = handlers.PATCH
