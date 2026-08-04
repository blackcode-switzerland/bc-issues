// @blackcode/platform-auth — platform authorisation.
//
// Today this package holds exactly one thing: per-app access enforcement, added
// in Phase 4. The session/token half of auth (`lib/auth.ts`, `lib/auth/*`) is
// still in apps/issues and moves here in Phase 6, once `events.ts` stops
// hardcoding issue/task/project entity types — see the Phase 2 decision table in
// PLATFORM-MIGRATION-PLAN.md. Extracting it early would mean doing Phase 6's work
// without Phase 6's migration.
//
// It is a package rather than app code because the alternative is every future
// app copying its own access check, and an app that gets that check subtly wrong
// is an app that leaks another team's data.

export { requireAppAccess, isAppAccessEnforced } from './require-app-access'
export type { RequireAppAccessArgs } from './require-app-access'
