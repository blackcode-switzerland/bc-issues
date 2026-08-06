// Writing to `platform.error_events`.
//
// Only the INSERT is here. The listings and the triage mutations
// (`listPublicErrorEvents`, `listAdminErrorEvents`, `setErrorEventResolved`, …)
// stay in `apps/issues/lib/db/queries/error-events.ts` for now: the routes that
// use them — the public status feed and the super-admin Errors tab — are Tier 2
// in docs/sales-app-plan.md D-2 and have not been factory-ised. Moving a query
// nothing shared calls yet is speculative extraction.
//
// The shared `apiHandler` does NOT use this. It writes its row with an
// interpolated `sql` statement in `platform-api/src/handler.ts`, because the
// only thing it is guaranteed to hold is a client, and its logging must survive
// anything — including being handed a transaction handle. This function exists
// for the deliberate, application-level report: a client error beacon.

import type { PlatformDb } from './client'
import { errorEvents, type NewErrorEvent } from './schema'

export async function insertErrorEvent(
  db: PlatformDb,
  row: Omit<NewErrorEvent, 'id' | 'occurred_at'>
): Promise<void> {
  await db.insert(errorEvents).values(row)
}
