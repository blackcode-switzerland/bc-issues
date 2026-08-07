// GET|POST|DELETE /api/workspaces/{ws}/links — `bk link`, D-18's storage.
//
// The other north-star step that 404'd from this host. A link joins two apps by
// URN, so refusing to serve it from the sales deployment meant an agent working
// in sales could not record the one relationship this project exists to record.
//
// Unpacked one line at a time, NOT `export const { GET, POST } = …` — a
// destructuring export serves traffic while dropping out of cli-parity's
// coverage check. See the header of platform-api/src/routes/index.ts.
import { linksRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = linksRoute(appContext)
export const GET = handlers.GET
export const POST = handlers.POST
export const DELETE = handlers.DELETE
