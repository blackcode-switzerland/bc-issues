// GET   /api/workspaces/{ws}/preferences — the caller's own display settings
// PATCH /api/workspaces/{ws}/preferences — change them
//
// ---------------------------------------------------------------------------
// THIS ROUTE STORES A PREFERENCE. IT DOES NOT GRANT OR WITHHOLD ANYTHING.
// ---------------------------------------------------------------------------
// `ui_mode` is D-7's affordance switch: `read_only` means the WEB APP renders no
// mutation affordances. **The server does not consult it** — not here and not
// anywhere else in this app. Authorisation is `platform.app_access` and the
// workspace role, unchanged, and a caller who sets `full` gains nothing: a write
// their access does not allow is refused exactly as it was before, and a write
// it does allow was always available through `bk`.
//
// So there is no authorisation question on the PATCH beyond "is this your own
// row", and that is answered by construction: `ctx.user.id` is the key, and this
// route offers no way to name somebody else's.
//
// ---------------------------------------------------------------------------
// WHY `/api/workspaces/{ws}/preferences` AND NOT `/api/me/sales-preferences`
// ---------------------------------------------------------------------------
// Phase 9's checklist wrote the second spelling and it is the wrong shape here,
// for a reason the checklist could not have known: `sales.user_preferences` is
// keyed on (user, workspace), so `/api/me/…` would have to carry the workspace
// as a query parameter or infer an active one. CLAUDE.md forbids the second
// outright ("never reintroduce implicit-active-workspace routes") and the first
// is the workspace-scoped shape with the scope moved into a parameter, which is
// the same route spelled less clearly.
//
// The `sales-` prefix that makes `sales-search` unambiguous is not needed: there
// is no PLATFORM preferences route to collide with, and `/api/workspaces/{ws}/…`
// is already this deployment's namespace.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getPreferences, setPreferences } from '@/lib/db/queries/preferences'
import { UI_MODE_VALUES } from '@/lib/pipeline'
import { str } from '@/lib/http-input'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  return NextResponse.json(await getPreferences(ctx.workspace.id, ctx.user.id))
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const uiMode = str(body?.ui_mode)
  if (uiMode !== undefined && !UI_MODE_VALUES.includes(uiMode)) {
    // Named, not listed — the same rule every other 400 in this app follows. The
    // values are served live by `bk meta`, and a stale list in front of an agent
    // that is already failing is worse than no list.
    throw Errors.badRequest(
      'unknown_ui_mode',
      `unknown ui_mode ${JSON.stringify(uiMode)}`,
      'run `bk meta` for the current ui_mode values — and note it is a display ' +
        'preference, not a permission'
    )
  }

  // `default_filters` is stored opaquely: it is this app's own UI state, the
  // server has no opinion about its shape, and validating it would mean the web
  // could not add a saved filter without a route change. `null` clears it.
  const defaultFilters = body && 'default_filters' in body ? body.default_filters : undefined

  if (uiMode === undefined && defaultFilters === undefined) {
    throw Errors.badRequest(
      'nothing_to_change',
      'pass ui_mode or default_filters',
      'run `bk sales preferences show` for the current values'
    )
  }

  return NextResponse.json(
    await setPreferences(ctx.workspace.id, ctx.user.id, { uiMode, defaultFilters })
  )
})
