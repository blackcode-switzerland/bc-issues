// GET /api/users — the user directory.
//
// Privacy guard: a caller only sees users they already share a workspace with
// (plus themselves). Discovering brand-new people is not possible here —
// invitations are sent blind, by email. The guard is inside the query's join
// (`getVisibleUsers`), not a filter applied after, so there is no shape of this
// route that could leak the global directory by forgetting a `where`.

import { NextRequest, NextResponse } from 'next/server'
import { getVisibleUsers } from '@blackcode/platform-db'
import type { AppContext } from '../app-context'
import { Errors } from '../errors'
import { createApiHandler } from '../handler'

export function usersRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)

  return apiHandler(async (req: NextRequest) => {
    const user = await app.resolveUser(req)
    if (!user) throw Errors.unauthorized()
    return NextResponse.json(await getVisibleUsers(app.db, user.id))
  })
}
