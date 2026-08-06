// Resolving a trash selection to row ids. Separate from `parse.ts` on purpose:
// that file is deliberately dependency-free so `parse.test.ts` can run without a
// database, and this needs one.

import { Errors } from '@blackcode/platform-api'
import {
  resolveNumberedRefs,
  TrashRefNotFoundError,
  type EntityRef,
} from '@/lib/db/queries/deletion'
import type { RestoreResolution } from '@/lib/db/queries/deletion'
import type { TrashSelection } from './parse'

/**
 * The selection as row-id refs, resolving any `{type, number}` items.
 *
 * Both trash routes go through here rather than resolving themselves: purge and
 * restore must agree byte-for-byte on what a ref means, and two call sites that
 * each build their own working set are two call sites that can disagree.
 *
 * A `#number` that matches nothing is a 404 naming every bad ref at once, not a
 * silently shorter list — a purge built from a partially-resolved selection is
 * exactly how the wrong row gets deleted.
 */
export async function resolveSelection(
  workspaceId: number,
  selection: TrashSelection
): Promise<EntityRef[]> {
  if (selection.numbered.length === 0) return selection.items
  try {
    const resolved = await resolveNumberedRefs(workspaceId, selection.numbered)
    return [...selection.items, ...resolved]
  } catch (err) {
    if (err instanceof TrashRefNotFoundError) {
      throw Errors.notFound(
        'unknown_ref',
        `no such item in this workspace: ${err.refs.map((r) => `${r.type}:${r.number}`).join(', ')}`,
        'run `bk <app> trash list` (`bk trash list` on bk 2.x) and pass a REF exactly as printed in its REF column'
      )
    }
    throw err
  }
}

/**
 * Rewrite restore-resolution keys from `type:#number` to `type:rowId`.
 *
 * Resolutions are keyed by the item they apply to, and `restoreEntity` looks
 * them up by row id. A 1.12.0+ client keys them by #number, because that is what
 * the conflict preview showed it.
 *
 * The mapping is built from THIS request's numbered selection, which is what
 * makes it unambiguous: a key is rewritten only when it names an item the caller
 * actually addressed by number. A pre-1.12.0 client sends no numbered items at
 * all, so `byNumber` is empty, nothing is rewritten, and its row-id keys pass
 * through exactly as they always have.
 */
export function remapResolutionKeys(
  selection: TrashSelection,
  resolved: EntityRef[],
  resolutions: Record<string, RestoreResolution>
): Record<string, RestoreResolution> {
  if (selection.numbered.length === 0) return resolutions

  // `resolveSelection` appends the resolved numbered refs after the legacy ones,
  // in order, so the tail lines up with `selection.numbered` index for index.
  const tail = resolved.slice(resolved.length - selection.numbered.length)
  const byNumber = new Map<string, string>()
  selection.numbered.forEach((ref, i) => {
    const row = tail[i]
    if (row) byNumber.set(`${ref.type}:${ref.number}`, `${row.type}:${row.id}`)
  })

  const out: Record<string, RestoreResolution> = {}
  for (const [key, value] of Object.entries(resolutions)) {
    out[byNumber.get(key) ?? key] = value
  }
  return out
}
