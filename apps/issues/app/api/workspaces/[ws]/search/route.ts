// GET /api/workspaces/{ws}/search — mounted from the shared factory.
//
// The implementation moved to `@blackcode/platform-api/routes` on 2026-08-06
// (docs/sales-app-plan.md Phase 1b, D-2) so every app serves it from its own
// origin, scoped to its own app slug. Read the factory for what it does and why
// it reads `platform.entities` and nothing else.
//
// Do not add app-specific behaviour here. If this route ever needs to know about
// issues, it stops being a platform route.

import { searchRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = searchRoute(appContext)
