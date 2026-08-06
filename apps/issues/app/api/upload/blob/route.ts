// POST /api/upload/blob — mounted from the shared factory.
//
// The client-direct handshake for large files. Same attribution rules as
// /api/upload, and the same reason it cannot be served by another app's host.

import { uploadBlobRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const POST = uploadBlobRoute(appContext)
