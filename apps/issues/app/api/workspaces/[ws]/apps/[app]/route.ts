// PATCH /api/workspaces/{ws}/apps/{app} — mounted from the shared factory.
//
// Class A. The "you cannot disable the app you are calling from" refusal reads
// `AppContext.appSlug`, so each deployment protects itself rather than whichever
// app the code was first written in.

import { workspaceAppRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = workspaceAppRoute(appContext)
export const PATCH = handlers.PATCH
