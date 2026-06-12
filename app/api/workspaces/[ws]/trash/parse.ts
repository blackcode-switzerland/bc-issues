// Shared parsing for trash route bodies: a selection is either a whole batch
// (batch_id) or an explicit list of {type, id} items, optionally with restore
// resolutions keyed "type:id".
// Import Errors from the errors module directly (not the @/lib/api barrel) so
// this stays dependency-free and unit-testable without a DB connection.
import { Errors } from '@/lib/api/errors'
import type { EntityRef, RestoreResolution, TrashType } from '@/lib/db/queries/deletion'

const TYPES = new Set<TrashType>(['issue', 'project', 'milestone'])

export interface TrashSelection {
  batchId: number | null
  items: EntityRef[]
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
  if (Array.isArray(b.items)) {
    for (const raw of b.items) {
      if (!raw || typeof raw !== 'object') {
        throw Errors.badRequest('invalid_item', 'each item must be { type, id }')
      }
      const it = raw as Record<string, unknown>
      const type = it.type as TrashType
      const id = Number(it.id)
      if (!TYPES.has(type) || !Number.isInteger(id)) {
        throw Errors.badRequest('invalid_item', 'item.type must be issue|project|milestone and id an integer')
      }
      items.push({ type, id })
    }
  }

  if (batchId === null && items.length === 0) {
    throw Errors.badRequest('empty_selection', 'provide batch_id or a non-empty items array')
  }
  return { batchId, items }
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
