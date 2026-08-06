// `resolveWorkspace` / `requireOwner`, bound to this app.
//
// The implementation moved to `@blackcode/platform-api` on 2026-08-06 —
// docs/sales-app-plan.md Phase 1a, decision D-2. The comment explaining the
// 401 / 404 / 403 gates and why each status is the one it is went WITH it, to
// `packages/platform-api/src/handler.ts`; read it there before changing any of
// them. In short: a workspace you are not a member of must 404 so its existence
// does not leak, while being a member without the app here must 403 with a
// suggestion, because you are the one person who can act on that fact.
//
// `WorkspaceContext` is re-exported so every `@/lib/api` import site is
// unchanged.

import { createResolveWorkspace } from '@blackcode/platform-api'
import { appContext } from './context'

export const resolveWorkspace = createResolveWorkspace(appContext)

export { requireOwner } from '@blackcode/platform-api'
export type { WorkspaceContext } from '@blackcode/platform-api'
