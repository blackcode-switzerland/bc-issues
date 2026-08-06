// GET/POST /api/tokens — mounted from the shared factory.
//
// Session-only, and the factory enforces it: it throws at import time if this
// app's AppContext has no `resolveSessionUser`. It does not fall back to
// `resolveUser` — a bearer token minting another bearer token is privilege
// escalation. See packages/platform-api/src/routes/tokens.ts.
//
// The handlers are assigned to named `export const`s one at a time rather than
// destructured (`export const { GET, POST } = …`). That is not style: the parity
// guard finds a route's methods with /export\s+(const|function)\s+GET\b/, and a
// destructuring export matches nothing — the route would serve fine while
// silently vanishing from the coverage check.

import { tokensRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = tokensRoute(appContext)

export const GET = handlers.GET
export const POST = handlers.POST
