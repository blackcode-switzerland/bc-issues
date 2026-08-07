// GET/POST /api/tokens — mounted from the shared factory.
//
// One login and one token across every blackcode app (D-16, §6), so this lists
// and mints the same `platform.api_tokens` rows issues does. It is served here
// because `bk login --server https://sales…` authorizes here (D-21) and because
// the page that revokes a token has to be able to reach one from this origin
// (D-10) — not because sales has tokens of its own.
//
// Session-only, and the factory enforces it at mount time: it throws if this
// app's AppContext supplies no `resolveSessionUser`, and it does not fall back
// to `resolveUser`. A bearer token that can mint another is privilege
// escalation — revoking the first would not revoke what it created.
//
// One `export const` per method, NOT `export const { GET, POST } = …`. The
// destructured form serves traffic identically and matches none of the patterns
// the parity guard reads, so the route would work while silently dropping out of
// the coverage check.

import { tokensRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = tokensRoute(appContext)

export const GET = handlers.GET
export const POST = handlers.POST
