// Who this app is, in the platform's terms.
//
// `APP_SLUG` is the identity this app presents to `platform.apps`,
// `platform.workspace_apps` and `platform.app_access`. It matches the row that
// migration 0034 inserts, the directory name under `apps/`, and — from Phase 5 —
// the CLI namespace (`bk issues …`) and the guide folder (`topics/issues/`).
//
// It lives in the app, never in packages/platform-*: a platform package that
// knew the slug would be a platform package that knew about one app. Every access
// check takes the slug as an argument for exactly that reason.

/** This app's slug in `platform.apps`. Must match migration 0034. */
export const APP_SLUG = 'issues'

/** Human name, for UI and for the denial messages an agent reads. */
export const APP_NAME = 'Blackcode Issues'
