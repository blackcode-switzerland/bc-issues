// The issues app's own server-enforced limits, plus the composed `limits` object
// that GET /api/meta serves.
//
// Platform-wide caps (workspace, token, profile, invitation, pagination) live in
// @blackcode/platform-api and are re-exported here so every existing
// `@/lib/limits` import keeps working. What stays in this file is the caps only
// an issue tracker has — a sales app has no use for ISSUE_TITLE_MAX and must not
// inherit it.
//
// The rule is unchanged: a limit is DECLARED once, IMPORTED by the route that
// enforces it, and SERVED by GET /api/meta (→ `bk meta.limits`). The embedded
// `bk guide` never restates a number.

import { PLATFORM_LENGTH_LIMITS } from '@blackcode/platform-api'

export {
  WORKSPACE_NAME_MAX,
  TOKEN_NAME_MAX,
  PROFILE_NAME_MAX,
  PROFILE_TAGLINE_MAX,
  INVITE_EMAIL_MAX,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  SEARCH_QUERY_MIN,
  SEARCH_RESULTS_MAX,
} from '@blackcode/platform-api'

/** Issue `title` — `app/api/workspaces/[ws]/issues/route.ts`. */
export const ISSUE_TITLE_MAX = 200
/** Project `name` — `app/api/workspaces/[ws]/projects/route.ts`. */
export const PROJECT_NAME_MAX = 100
/** Task `name` — `app/api/workspaces/[ws]/tasks/route.ts`. */
export const TASK_NAME_MAX = 100
/** Label `name` — `app/api/workspaces/[ws]/labels/route.ts` (and inline label creation). */
export const LABEL_NAME_MAX = 50

/**
 * The character/count caps GET /api/meta serves under `limits`.
 *
 * Still one flat object, because that is the shape `bk meta` reads today.
 * Phase 5 regroups it as `apps.issues.limits` alongside a platform block — see
 * docs/platform-architecture.md §7.4. Keep the two halves visibly separate until then.
 */
export const LENGTH_LIMITS = {
  issue_title_max: ISSUE_TITLE_MAX,
  project_name_max: PROJECT_NAME_MAX,
  task_name_max: TASK_NAME_MAX,
  label_name_max: LABEL_NAME_MAX,
  ...PLATFORM_LENGTH_LIMITS,
} as const
