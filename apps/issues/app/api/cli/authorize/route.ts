// POST /api/cli/authorize — mounted from the shared factory.
//
// Class A. D-21 makes it Tier 1 for every deployed app: `bk login --server
// https://sales.blackcode.ch` is a legitimate command, and a 404 there is the
// invisible failure D-1 exists to remove.
//
// It mints a token, so it resolves a BROWSER SESSION only and the factory throws
// at mount time if this app supplies no session resolver. This app supplies
// `getValidatedSessionUser`, which rejects a session issued before the account's
// last password reset — see docs/changelog/platform.md, 2026-08-06.

import { cliAuthorizeRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const POST = cliAuthorizeRoute(appContext)
