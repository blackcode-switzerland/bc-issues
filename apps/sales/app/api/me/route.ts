// GET   /api/me — who the caller is
// PATCH /api/me — edit your own profile
//
// Mounted from the shared factory. `platform.users` is one row per person across
// every app, so a name changed here is the name issues shows: this is the
// platform's account, served from this origin because every fetch this app makes
// goes to its own origin (D-10).
//
// ---------------------------------------------------------------------------
// **DELETE IS NOT EXPORTED, AND THAT IS A DECISION**
// ---------------------------------------------------------------------------
// The factory returns one. This app does not serve it.
//
// Closing a blackcode account is irreversible, it reaches across every app —
// soft-deleting the user, hard-deleting solely-owned workspaces, revoking every
// token — and none of that is a sales operation. Two deployments each offering
// their own button to do it is two places to get it wrong and two places somebody
// has to look before believing it is gone. `apps/issues` serves it, behind a
// typed confirmation; `/dashboard/settings/account` here says so and links there
// rather than growing a second copy.
//
// This is also the difference between a mount and a re-export: exporting all
// three would put `DELETE /api/me` into this app's parity check, where it is an
// uncovered capability — the operation `apps/issues` documents as deliberately
// unreachable from `bk`, because an agent must never delete its owner's account.
// Not exporting it is the honest answer to both questions at once.
import { meRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

// One line per method — NOT `export const { GET, PATCH } = handlers`. The
// destructured form serves traffic identically and matches none of the patterns
// the parity guard reads, so the route would work while silently dropping out of
// the coverage check (`packages/platform-testing/src/cli-parity.ts`).
const handlers = meRoute(appContext)
export const GET = handlers.GET
export const PATCH = handlers.PATCH
