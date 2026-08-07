// GET|POST|DELETE /api/workspaces/{ws}/links — `bk link`.
//
// A link joins two apps by URN. Refusing to serve it from this deployment means
// an agent working in this app cannot record the one relationship a multi-app
// platform exists to record — so this is a cross-app verb and every app mounts
// it.
//
// Unpacked one line at a time, NOT `export const { GET, POST } = …`.
import { linksRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = linksRoute(appContext)
export const GET = handlers.GET
export const POST = handlers.POST
export const DELETE = handlers.DELETE
