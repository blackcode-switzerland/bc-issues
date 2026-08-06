export { createDb } from './client'
export type { PlatformDatabase, PlatformDb } from './client'
export * from './schema'
export * from './app-access'
export * from './urn'
export * from './entities'
export * from './links'

// Platform reads the shared route factories need (2026-08-06, Phase 1b / D-2).
// Each app's query layer re-exports these bound to its own `db`, so existing
// call sites are unchanged.
export * from './directory'
export * from './workspace-listing'
export * from './error-events'
