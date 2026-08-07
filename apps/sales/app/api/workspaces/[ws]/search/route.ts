// GET /api/workspaces/{ws}/search — `bk search`, the cross-app one.
//
// A NORTH-STAR STEP, and it 404'd from this host until 2026-08-07. The factory
// reads `platform.entities` and nothing else, so this deployment answers for
// every app — which is the entire reason the route stopped living in one app's
// tree (B-2). Mounting it is what makes `bk guide platform/apps`' sentence
// "cross-app: any app answers alike" true rather than aspirational.
import { searchRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = searchRoute(appContext)
