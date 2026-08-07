// The #number allocator.
//
// ---------------------------------------------------------------------------
// ONE STATEMENT, INSIDE THE CALLER'S TRANSACTION. BOTH HALVES MATTER.
// ---------------------------------------------------------------------------
// Every function here takes a transaction handle and never opens one. Call it
// from inside the transaction that inserts the row it numbers:
//
//     return await db.transaction(async (tx) => {
//       const seq = await allocateSeq(tx, workspaceId, 'prospect')
//       const [row] = await tx.insert(prospects).values({ …, seq }).returning()
//       await recordEvent(tx, …)
//       await projectEntity(tx, …)
//       return row
//     })
//
// ── WHY TWO CONCURRENT CREATES CANNOT COLLIDE ───────────────────────────────
// `INSERT … ON CONFLICT DO UPDATE` takes a ROW LOCK on the conflicting row and
// re-reads it under that lock. A second transaction running the same statement
// BLOCKS until the first commits or rolls back, then increments the committed
// value. Two simultaneous `prospect create` calls get 12 and 13 — never 12
// twice, and never a unique-violation on `uq_prospects_ws_seq`.
//
// ── WHY NOT A BARE `UPDATE … RETURNING` ─────────────────────────────────────
// §5.1 of the plan spells it that way, and a bare UPDATE is not enough: the
// FIRST allocation for a (workspace, entity_type) pair has no row to update and
// returns zero rows. The obvious recovery — "UPDATE, and INSERT if that returned
// nothing" — is precisely the read-then-write §5.1 forbids: two concurrent
// first-creates both see zero rows and both insert, and one of them fails on the
// primary key (best case) or they race to the same seq (worse). The upsert is
// still one statement and has neither problem, so this satisfies the PROPERTY
// §5.1 names rather than its literal verb.
//
// ── A ROLLBACK LOSES THE NUMBER, AND THAT IS CORRECT ────────────────────────
// The counter row is rolled back with everything else, so a failed create leaves
// no gap. But a create that succeeds and is later deleted DOES leave one, and
// nothing reuses it: #numbers are identity, not a count. `bc:sales:acme/prospect/12`
// must never point at a second thing, so a gap is the cheap half of the trade.

import { sql } from 'drizzle-orm'
import type { Executor } from '@blackcode/platform-db'
import type { SalesEntityType } from '@/lib/entity-address'

/**
 * The next `seq` for one (workspace, entity type), allocated atomically.
 *
 * `entityType` is typed to the projected types rather than left as a string:
 * every counter this app keeps belongs to an addressable entity, and a typo
 * would silently start a fresh sequence at 1 rather than fail.
 */
export async function allocateSeq(
  tx: Executor,
  workspaceId: number,
  entityType: SalesEntityType
): Promise<number> {
  const res = await tx.execute(sql`
    INSERT INTO sales.counters (workspace_id, entity_type, last_seq)
    VALUES (${workspaceId}, ${entityType}, 1)
    ON CONFLICT (workspace_id, entity_type)
      DO UPDATE SET last_seq = sales.counters.last_seq + 1
    RETURNING last_seq
  `)
  const seq = res.rows[0]?.last_seq
  if (seq == null) {
    // Unreachable: the upsert always returns a row. A throw rather than a
    // fallback, because a silent `1` here would collide with an existing row and
    // the failure would surface as a unique violation three layers away.
    throw new Error(
      `allocateSeq: no row returned for workspace ${workspaceId}, type ${entityType}`
    )
  }
  return Number(seq)
}
