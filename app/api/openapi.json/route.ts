// Deprecation stub. The OpenAPI spec has been retired: blackcode issues is
// operated through the `bk` CLI, and the HTTP API is private plumbing with no
// public contract.
//
// This returns 410 Gone rather than 404 on purpose. A 410 carrying a
// `suggestion` is something an agent can act on inside the same run — it names
// the fix. A 404 just looks like a bug, and the agent retries or gives up.
//
// Lifetime: indefinite. Its audience is an agent working from stale context that
// still has this URL in its prompt, and that can turn up at any time.
// After it closes, delete this route, its sibling /api/docs, and their entries
// in lib/cli-parity.test.ts's EXCLUDED_PATHS.

import { NextResponse } from 'next/server'
import { RETIRED_SURFACE_BODY } from '@/lib/api/retired'

export function GET() {
  return NextResponse.json(RETIRED_SURFACE_BODY, {
    status: 410,
    headers: { 'Cache-Control': 'public, max-age=300' },
  })
}
