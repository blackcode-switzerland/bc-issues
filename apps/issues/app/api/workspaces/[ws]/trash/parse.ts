// Shared parsing for trash route bodies: a selection is either a whole batch
// (batch_id) or an explicit list of {type, id} items, optionally with restore
// resolutions keyed "type:id".
// Import Errors from the errors module directly (not the @/lib/api barrel) so
// this stays dependency-free and unit-testable without a DB connection.
import { Errors } from '@blackcode/platform-api'
import type {
  EntityRef,
  NumberedRef,
  RestoreResolution,
  TrashType,
} from '@/lib/db/queries/deletion'

const TYPES = new Set<TrashType>(['issue', 'project', 'task'])

// ---------------------------------------------------------------------------
// TWO SPELLINGS FOR AN ITEM, AND WHY BOTH MUST EXIST
// ---------------------------------------------------------------------------
//   { type, id }     — the ROW id. What every client shipped before 1.12.0
//                      sends, because that is what `bk trash list` printed.
//   { type, number }  — the workspace #number. What 1.12.0+ sends, matching
//                      URNs and every other command.
//
// The field name carries the meaning, and that is not a stylistic choice. If
// `id` had been redefined to mean #number, every INSTALLED binary would have
// gone on sending row ids into a server reading them as #numbers — and this is
// the purge path. `issue:905` would have silently become "whatever issue is
// #905". A wrong delete, on every client, with no error anywhere.
//
// That is the Phase 7 lesson applied before the fact rather than after: the new
// server must be backwards compatible with the old clients that are still
// installed, and a client cannot be asked to know a convention that shipped
// after it did. The two forms are distinguishable, so both are safe.
//
// A single item carrying BOTH keys is rejected rather than guessed at.

export interface TrashSelection {
  batchId: number | null
  /** Items addressed by ROW id (legacy `{type, id}`). Already resolved. */
  items: EntityRef[]
  /** Items addressed by #number (`{type, number}`). Resolve before use. */
  numbered: NumberedRef[]
}

export function parseSelection(body: unknown): TrashSelection {
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }
  const b = body as Record<string, unknown>

  let batchId: number | null = null
  if (b.batch_id !== undefined && b.batch_id !== null) {
    const n = Number(b.batch_id)
    if (!Number.isInteger(n)) throw Errors.badRequest('invalid_batch_id', 'batch_id must be an integer')
    batchId = n
  }

  const items: EntityRef[] = []
  const numbered: NumberedRef[] = []
  if (Array.isArray(b.items)) {
    for (const raw of b.items) {
      if (!raw || typeof raw !== 'object') {
        throw Errors.badRequest('invalid_item', 'each item must be { type, number }')
      }
      const it = raw as Record<string, unknown>
      const type = it.type as TrashType
      if (!TYPES.has(type)) {
        throw Errors.badRequest('invalid_item', 'item.type must be issue|project|task')
      }
      const hasNumber = it.number !== undefined && it.number !== null
      const hasId = it.id !== undefined && it.id !== null

      if (hasNumber && hasId) {
        // Never guess. One means a #number and the other a row id; picking
        // either would be picking which row to delete on the client's behalf.
        throw Errors.badRequest(
          'ambiguous_item',
          'an item may carry `number` (the #number) or `id` (the row id), not both',
          'send { "type": "issue", "number": 42 } — `id` is the pre-1.12.0 spelling'
        )
      }
      if (hasNumber) {
        const n = Number(it.number)
        if (!Number.isInteger(n) || n < 1) {
          throw Errors.badRequest('invalid_item', 'item.number must be a positive integer (#number)')
        }
        numbered.push({ type, number: n })
      } else if (hasId) {
        const n = Number(it.id)
        if (!Number.isInteger(n)) {
          throw Errors.badRequest('invalid_item', 'item.id must be an integer (row id)')
        }
        items.push({ type, id: n })
      } else {
        throw Errors.badRequest(
          'invalid_item',
          'each item needs `number` (the #number) or `id` (the row id)',
          'run `bk <app> trash list` (`bk trash list` on bk 2.x) and pass a REF exactly as printed'
        )
      }
    }
  }

  if (batchId === null && items.length === 0 && numbered.length === 0) {
    throw Errors.badRequest('empty_selection', 'provide batch_id or a non-empty items array')
  }
  return { batchId, items, numbered }
}

export function parseResolutions(body: unknown): Record<string, RestoreResolution> {
  const out: Record<string, RestoreResolution> = {}
  if (!body || typeof body !== 'object') return out
  const r = (body as Record<string, unknown>).resolutions
  if (!r || typeof r !== 'object') return out
  for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
    if (v === 'restore_parent' || v === 'standalone') out[k] = v
  }
  return out
}
