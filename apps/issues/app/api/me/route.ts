// /api/me — mounted from the shared factory.
//
// One login serves every app, so this answers the same thing on every origin —
// but it has to BE on every origin: a page on another app's domain cannot reach
// this deployment to find out who is signed in.
//
// DELETE stays deliberately unreachable from `bk` (EXCLUDED_OPERATIONS in
// lib/cli-parity.test.ts): an agent must never delete its owner's account.
//
// Named exports assigned one at a time — the parity guard matches
// /export\s+(const|function)\s+GET\b/ and a destructuring export matches nothing.

import { meRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = meRoute(appContext)

export const GET = handlers.GET
export const PATCH = handlers.PATCH
export const DELETE = handlers.DELETE
