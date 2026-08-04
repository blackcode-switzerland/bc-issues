// Platform-wide server-enforced limits.
//
// Why this file exists: these caps used to live inline in each route handler and
// were re-typed by hand into the OpenAPI spec and the platform reference — where
// two of them were already wrong. The rule now: a limit is DECLARED once,
// IMPORTED by the route that enforces it, and SERVED by GET /api/meta. The
// embedded `bk guide` never restates a number — it points at `bk meta`. So a cap
// can change without shipping a new CLI, and it can never disagree with the code
// that enforces it.
//
// WHAT BELONGS HERE: caps on things every app has — workspaces, tokens,
// profiles, invitations, pagination. An app's own entity caps (an issue title, a
// deal name) belong to that app, because a sales app has no use for
// ISSUE_TITLE_MAX and must not inherit it. See apps/issues/lib/limits.ts.
//
// Deliberately dependency-free so any route can import it without pulling in
// anything else.

/** Workspace `name` — `app/api/workspaces/route.ts` and `.../[ws]/route.ts`. */
export const WORKSPACE_NAME_MAX = 80
/** API token `name` — `app/api/tokens/route.ts`. */
export const TOKEN_NAME_MAX = 100
/** Profile `name` — `app/api/me/route.ts`. */
export const PROFILE_NAME_MAX = 255
/** Profile `tagline` — `app/api/me/route.ts`. */
export const PROFILE_TAGLINE_MAX = 140
/** Invitation `email` — `app/api/workspaces/[ws]/invitations/route.ts`. */
export const INVITE_EMAIL_MAX = 255
/** `POST /api/undo { count }` is CLAMPED to this — it does not error above it. */
export const UNDO_MAX_COUNT = 10

/** Keyset-paginated feeds (activity, trash, inbox, super-admin errors). */
export const PAGE_SIZE_DEFAULT = 50
export const PAGE_SIZE_MAX = 200

/** The platform half of what GET /api/meta serves under `limits`. */
export const PLATFORM_LENGTH_LIMITS = {
  workspace_name_max: WORKSPACE_NAME_MAX,
  token_name_max: TOKEN_NAME_MAX,
  profile_name_max: PROFILE_NAME_MAX,
  profile_tagline_max: PROFILE_TAGLINE_MAX,
  invite_email_max: INVITE_EMAIL_MAX,
  undo_max_count: UNDO_MAX_COUNT,
  page_size_default: PAGE_SIZE_DEFAULT,
  page_size_max: PAGE_SIZE_MAX,
} as const
