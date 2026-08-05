// The issues app's API barrel.
//
// The app-agnostic half — the error envelope, the list envelope, log
// sanitisation — now lives in @blackcode/platform-api and is re-exported here so
// every existing `@/lib/api` import keeps working unchanged.
//
// What stays app-local is what names an issue, task or project: the entity
// serializers, seq→id resolution, and analytics parameter parsing.
export { ApiError, Errors, errorBody, jsonList, sanitize, truncate } from '@blackcode/platform-api'
export type { ListPage } from '@blackcode/platform-api'

export { apiHandler } from './handler'
export { resolveWorkspace, requireOwner } from './workspace-context'
export type { WorkspaceContext } from './workspace-context'
export { resolveEntityId } from './resolve-entity'
export {
  publicProject,
  publicTask,
  publicIssue,
  publicComment,
  publicAttachment,
  publicProjectUpdate,
  publicEvent,
} from './serialize'
export { parseAnalyticsParams } from './analytics-params'
export type { ParsedAnalyticsParams } from './analytics-params'
