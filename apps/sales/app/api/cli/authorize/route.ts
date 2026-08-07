// POST /api/cli/authorize — mounted from the shared factory.
//
// D-21 makes this Tier 1 for EVERY deployed app. `bk login --server
// https://sales.blackcode.ch` is a legitimate command — an agent naming the app
// it is about to work in — and a 404 there is the invisible failure D-1 exists
// to remove. Serving it here is not "sales has its own login": the token it
// mints is the same platform-wide `bk_live_…` credential, in the same
// `platform.api_tokens`, which is exactly why this is one shared factory rather
// than a route each app could scope differently.
//
// It MINTS a token, so it resolves a BROWSER SESSION only — a bearer token that
// could mint another is privilege escalation, and revoking the first would not
// revoke the second. The factory throws at mount time if this app supplies no
// session resolver; `lib/api.ts` supplies `getValidatedSessionUser`, which
// rejects a session issued before the account's last password reset (D-24).
//
// **Excluded from CLI parity, and the reason is the same as in `apps/issues`:**
// the binary never calls this route. It opens `/cli/authorize` in a browser and
// the PAGE posts here. A `bk` command for it would be a command that signs a
// browser in, which is `bk login`, and that goes somewhere else.
import { cliAuthorizeRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const POST = cliAuthorizeRoute(appContext)
