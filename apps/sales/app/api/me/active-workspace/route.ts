// POST /api/me/active-workspace — the write half of `bk workspace use`.
//
// Pairs with GET /api/workspaces. Mounting one without the other gives a CLI
// that can list workspaces and not select one, which is a worse dead end than
// neither.
import { activeWorkspaceRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const POST = activeWorkspaceRoute(appContext)
