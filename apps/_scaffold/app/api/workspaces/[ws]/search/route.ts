// GET /api/workspaces/{ws}/search — `bk search`, the CROSS-APP one.
//
// The factory reads `platform.entities` and nothing else, so this deployment
// answers for EVERY app — which is the entire reason the route stopped living in
// one app's tree. Mounting it is what makes "cross-app: any app answers alike"
// true rather than aspirational.
//
// It is also why `lib/db/queries/entities.ts` matters: this route can only find
// rows some app has projected. An app that skips the projection is an app whose
// records are invisible to `bk search` from everywhere, including from itself.
import { searchRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = searchRoute(appContext)
