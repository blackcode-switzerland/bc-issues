export { ApiError, Errors, errorBody } from './errors'
export { jsonList } from './responses'
export type { ListPage } from './responses'
export { sanitize, truncate } from './sanitize'
export * from './limits'

// Per-app access enforcement — the 403-with-a-hint. Moved here from
// @blackcode/platform-auth on 2026-08-06; that file's header says why.
export { requireAppAccess, isAppAccessEnforced } from './require-app-access'
export type { RequireAppAccessArgs } from './require-app-access'

// The shared request layer (2026-08-06, docs/sales-app-plan.md Phase 1a / D-2).
// An app binds these to its own AppContext in `lib/api` — see handler.ts.
export type { AppContext, AppManifest } from './app-context'
export {
  createApiHandler,
  createResolveWorkspace,
  requireOwner,
  errorLogContext,
} from './handler'
export type { WorkspaceContext } from './handler'
