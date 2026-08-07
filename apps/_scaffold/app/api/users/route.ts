// GET /api/users — `bk user view`. Identity is platform data; no app owns it.
//
// ═══════════════════════════════════════════════════════════════════════════
// THIS DIRECTORY IS THE POINT OF THE SCAFFOLD. READ THIS ONE FILE FIRST.
// ═══════════════════════════════════════════════════════════════════════════
// A `bk` verb in the NEUTRAL or CROSS-APP tier must answer from EVERY app's
// deployment, because the CLI asks whichever host the user is homed on. A
// deployment that does not mount these serves a 404 page to commands that have
// nothing to do with it — and `bk workspace use`, which almost every later
// command depends on, is one of them.
//
// That is not hypothetical. On 2026-08-07 the sales app served 7 of the 54
// platform routes, and the north-star run — the sentence this whole platform was
// justified by — failed on its second command. `bk search` and `bk link create`
// 404'd. It only completed after `bk app use issues`, i.e. after a server
// switch, which is the thing the sentence forbids.
//
// The scaffold shipped with NONE of them, so the second app had no list to work
// from and nobody noticed until the app was otherwise finished.
//
// ── D-36, AS AMENDED: A SUBSET IS FINE. AN ACCIDENTAL ONE IS A BUG. ────────
// You are not required to mount all of them. `bk super-admin` legitimately lives
// in one app. The test is: **does every bare verb have a host, from THIS app's
// login?** If the answer is "yes, but you have to switch apps first", the subset
// is accidental and it is a bug.
import { usersRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = usersRoute(appContext)
