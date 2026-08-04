// Single source of truth for every server-enforced size limit an agent can hit.
//
// Why this file exists: these caps used to live inline in each route handler and
// were re-typed by hand into the OpenAPI spec and the platform reference — where
// two of them were already wrong (the 80-char workspace-name cap was documented
// nowhere; `GET /api/upload` never returned the `maxBytes` the reference claimed).
//
// The rule now: a limit is DECLARED here, IMPORTED by the route that enforces it,
// and SERVED by GET /api/meta (→ `bk meta.limits`, assembled in lib/agent-meta.ts).
// The embedded `bk guide` never restates a number — it points at `bk meta`. So a
// cap can change without shipping a new CLI, and it can never disagree with the
// code that enforces it.
//
// Deliberately dependency-free so any route can import it without pulling in the
// upload/rich-text modules.

/** Issue `title` — `app/api/workspaces/[ws]/issues/route.ts`. */
export const ISSUE_TITLE_MAX = 200
/** Project `name` — `app/api/workspaces/[ws]/projects/route.ts`. */
export const PROJECT_NAME_MAX = 100
/** Task `name` — `app/api/workspaces/[ws]/tasks/route.ts`. */
export const TASK_NAME_MAX = 100
/** Label `name` — `app/api/workspaces/[ws]/labels/route.ts` (and inline label creation). */
export const LABEL_NAME_MAX = 50
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

/** The character/count caps GET /api/meta serves under `limits`. */
export const LENGTH_LIMITS = {
  issue_title_max: ISSUE_TITLE_MAX,
  project_name_max: PROJECT_NAME_MAX,
  task_name_max: TASK_NAME_MAX,
  label_name_max: LABEL_NAME_MAX,
  workspace_name_max: WORKSPACE_NAME_MAX,
  token_name_max: TOKEN_NAME_MAX,
  profile_name_max: PROFILE_NAME_MAX,
  profile_tagline_max: PROFILE_TAGLINE_MAX,
  invite_email_max: INVITE_EMAIL_MAX,
  undo_max_count: UNDO_MAX_COUNT,
  page_size_default: PAGE_SIZE_DEFAULT,
  page_size_max: PAGE_SIZE_MAX,
} as const
