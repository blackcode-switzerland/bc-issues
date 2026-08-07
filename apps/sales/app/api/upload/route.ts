// GET  /api/upload — the limits and the block list, live
// POST /api/upload — store a file AGAINST THIS APP
//
// ---------------------------------------------------------------------------
// THIS IS WHY `bk sales upload` IS SPELLED WITH THE APP NAME (D-11)
// ---------------------------------------------------------------------------
// The server records `platform.uploads.app` from the deployment that RECEIVED
// the file, and new blobs land under `<app>/<workspace>/<file>`. Both are
// permanent: `pathname` is where the bytes are and nothing moves them, and
// `app` is who must answer for the file when the cross-app delete gate asks
// whether anything still references it.
//
// So a sales contract uploaded through the issues host is an issues file for
// ever, in the issues folder, and nothing about it says that was a mistake.
// That is the whole reason this route is Tier 1 rather than "sales can use the
// issues one for now".
//
// One export per method, never `export const { GET, POST } = …`: the parity
// guard reads a route's verbs with a regex and a destructured export matches
// nothing, so the route would serve while dropping out of the coverage check.
// `packages/platform-testing` now detects and refuses that form.
import { uploadRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = uploadRoute(appContext)
export const GET = handlers.GET
export const POST = handlers.POST
