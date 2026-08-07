// POST /api/upload/blob — the client-upload handshake for large files
//
// The browser and the CLI both take this path when a file is too big to POST
// through a function: the server signs a token, the client PUTs the bytes
// straight to blob storage, and the callback records the ledger row. It is part
// of `bk <app> upload`, which is why the command claims all three routes.
//
// Mounted for the same reason as its sibling — see that file's header. The
// attribution is decided by which host answers.
import { uploadBlobRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const POST = uploadBlobRoute(appContext)
