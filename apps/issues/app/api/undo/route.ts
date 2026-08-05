// Deprecation stub. `bk undo` and its routes were removed in 1.12.0 — the
// feature never worked (`platform.transaction_log` had no writer, so every undo
// reported zero operations).
//
// ---------------------------------------------------------------------------
// WHY A STUB AND NOT JUST A DELETED ROUTE
// ---------------------------------------------------------------------------
// Deleting the route left Next serving its HTML 404 page, and every INSTALLED
// binary still has the `bk undo` command and still calls this path. The CLI
// printed ~2KB of raw HTML to stderr — no code, no suggestion, nothing an agent
// can act on. Found by step 4b of the cutover: running the PUBLISHED 1.11.0
// binary against the new build, which is the only thing that could have found
// it. A health check exercises the server's own paths, never a client's.
//
// So: 410 with a `suggestion`, the same treatment /api/openapi.json gets. A 410
// carrying a suggestion is something an agent can recover from inside the same
// run; a 404 just looks like a bug, and the agent retries or gives up.
//
// GENERALISES TO: removing a route that installed clients still call is not
// finished when the route is gone. It is finished when the old client gets an
// actionable answer.
//
// Lifetime: until 1.11.x is no longer plausibly installed anywhere — i.e. after
// CLI_MIN_VERSION passes 1.12.0. Delete this route and its EXCLUDED_PATHS entry
// in lib/cli-parity.test.ts together.

import { NextResponse } from 'next/server'

const GONE = {
  error:
    '`bk undo` was removed in 1.12.0. It never recorded anything and could not undo — the transaction log it read was never written.',
  code: 'surface_retired',
  suggestion:
    'deletes are restorable: `bk trash list`, then `bk trash restore <type>:<#number>`',
  details: {
    replaces: {
      'bk undo': 'bk trash list / bk trash restore',
      'GET /api/undo': 'GET /api/workspaces/{ws}/trash',
      'POST /api/undo': 'POST /api/workspaces/{ws}/trash/restore',
    },
  },
} as const

function gone() {
  return NextResponse.json(GONE, {
    status: 410,
    headers: { 'Cache-Control': 'public, max-age=300' },
  })
}

export const GET = gone
export const POST = gone
