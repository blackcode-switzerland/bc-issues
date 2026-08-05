// The fail-closed proofs for app-aware reference counting.
//
// Phase 7 turned "scan six tables I know about" into "ask every app that
// registered a scanner", and the caller of that answer calls Vercel Blob
// `del()`, which has no undo. So the tests that matter here are not the ones
// showing deletion works — they are the ones showing deletion is REFUSED
// whenever the answer is anything less than a proven "nobody references this".
//
// Four ways to get that wrong, one test each:
//   - a second app references the file            → refuse
//   - a second app is enabled but has no scanner  → refuse (error, not `false`)
//   - a scanner fails                             → refuse
//   - nothing is registered at all                → refuse
//
// Plus one showing a genuine orphan really is deleted, because a GC that never
// deletes is a different bug.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  PLATFORM_REF_APP,
  ReferenceCoverageError,
  clearReferenceScanners,
  computeWorkspaceReferences,
  isUrlReferencedAnywhere,
  registerReferenceScanner,
  registeredScannerApps,
  sweepOrphanedUrls,
  type Executor,
  type ReferenceScanner,
  type ScannedReference,
} from '@blackcode/platform-storage'

// The bytes-deleting call, stubbed. Every assertion below is ultimately about
// whether this was reached.
const del = vi.fn(async () => {})
vi.mock('@vercel/blob', () => ({ del: (...args: unknown[]) => del(...(args as [])) }))

const BLOB = 'https://abc123.public.blob.vercel-storage.com'
const FILE = `${BLOB}/issues/acme/1-report.pdf`

/** An enabled app, as `platform.apps` describes it to the registry. */
type FakeApp = string | { slug: string; maintains_blob_index: boolean }

/**
 * A db stand-in that answers the three statements the registry issues.
 *
 * It dispatches on a literal fragment of each query rather than on call order,
 * so reordering the implementation does not silently change what the fake
 * returns — which would turn a real regression into a green test.
 */
function fakeDb(
  enabledApps: FakeApp[],
  /** url → the apps whose INDEX rows point at it (Phase 8). */
  indexed: Record<string, string[]> = {}
): Executor {
  const apps = enabledApps.map((a) =>
    typeof a === 'string' ? { slug: a, maintains_blob_index: false } : a
  )
  return {
    async execute(query) {
      const text = sqlText(query)
      // isUrlReferencedByIndex — `SELECT EXISTS (…) AS referenced`
      if (text.includes('AS referenced')) {
        const [url, wanted] = sqlParams(query) as [string, string[]]
        return { rows: [{ referenced: (indexed[url] ?? []).some((a) => wanted.includes(a)) }] }
      }
      // listIndexedWorkspaceReferences
      if (text.includes('source_type')) {
        const [, wanted] = sqlParams(query) as [number, string[]]
        const rows = Object.entries(indexed).flatMap(([url, appsFor]) =>
          appsFor
            .filter((a) => wanted.includes(a))
            .map((app) => ({ url, app, source_type: 'record', source_id: 1 }))
        )
        return { rows }
      }
      // listEnabledAppCoverage, and anything else (the ledger delete ignores it)
      return { rows: apps }
    },
  }
}

// A Drizzle `SQL` is a list of chunks: literal fragments (a `StringChunk`, an
// object whose sole own property `value` is a string[]), bound parameters
// (the raw JS value, interpolated as-is) and table references (Drizzle objects).
// Nothing here relies on a class name, so a minified build reads the same.
// Nested `sql` fragments stay nested rather than being spliced in, so this
// flattens them — `index-refs.ts` builds its array parameters that way.
function chunksOf(query: unknown): unknown[] {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks
  if (!chunks) return []
  return chunks.flatMap((c) =>
    (c as { queryChunks?: unknown[] })?.queryChunks ? chunksOf(c) : [c]
  )
}

const asLiteral = (c: unknown): string[] | null => {
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return null
  const v = (c as { value?: unknown }).value
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null
}

const isScalar = (x: unknown) => typeof x === 'string' || typeof x === 'number'

/** The literal SQL fragments of a Drizzle query, for the fake's dispatch. */
function sqlText(query: unknown): string {
  return chunksOf(query)
    .map((c) => asLiteral(c)?.join('') ?? '')
    .join(' ')
}

/**
 * The bound parameters, in order. Tables and literal fragments are skipped.
 *
 * Two shapes, because Drizzle uses both: a value interpolated directly is the
 * raw JS value, while `sql.param(x)` produces a `Param` wrapper (recognised by
 * carrying an `encoder` alongside its `value`). `index-refs.ts` needs the
 * wrapper for its `= ANY(…::text[])` arrays, so both appear here.
 */
function sqlParams(query: unknown): unknown[] {
  return chunksOf(query)
    .filter((c) => isScalar(c) || (Array.isArray(c) && c.every(isScalar)) || isParamWrapper(c))
    .map((c) => (isParamWrapper(c) ? c.value : c))
}

const isParamWrapper = (c: unknown): c is { value: unknown } =>
  typeof c === 'object' && c !== null && !Array.isArray(c) && 'encoder' in c && 'value' in c

function scanner(
  app: string,
  opts: { references?: boolean; fail?: boolean; refs?: ScannedReference[] } = {}
): ReferenceScanner {
  return {
    app,
    async scanWorkspace() {
      if (opts.fail) throw new Error(`${app} scanner exploded`)
      return opts.refs ? new Map([[FILE, opts.refs]]) : new Map()
    },
    async isUrlReferenced() {
      if (opts.fail) throw new Error(`${app} scanner exploded`)
      return Boolean(opts.references)
    },
  }
}

beforeEach(() => {
  clearReferenceScanners()
  del.mockClear()
})

describe('reference coverage', () => {
  it('refuses to answer when an enabled app has no registered scanner', async () => {
    registerReferenceScanner(scanner('issues'))
    const db = fakeDb(['issues', 'sales'])

    // The dangerous outcome would be `false` — "nobody references it, delete
    // away". It must be an error instead.
    await expect(isUrlReferencedAnywhere(db, FILE)).rejects.toBeInstanceOf(ReferenceCoverageError)
    await expect(computeWorkspaceReferences(db, 1)).rejects.toBeInstanceOf(ReferenceCoverageError)
  })

  it('refuses to answer when nothing is registered at all', async () => {
    await expect(isUrlReferencedAnywhere(fakeDb(['issues']), FILE)).rejects.toBeInstanceOf(
      ReferenceCoverageError
    )
  })

  it('refuses to answer when the app registry itself is empty', async () => {
    registerReferenceScanner(scanner('issues'))
    await expect(isUrlReferencedAnywhere(fakeDb([]), FILE)).rejects.toBeInstanceOf(
      ReferenceCoverageError
    )
  })

  it('treats an empty url as referenced', async () => {
    expect(await isUrlReferencedAnywhere(fakeDb(['issues']), '')).toBe(true)
  })

  it('reports what is registered', () => {
    registerReferenceScanner(scanner('sales'))
    registerReferenceScanner(scanner('issues'))
    expect(registeredScannerApps()).toEqual(['issues', 'sales'])
  })

  it('re-registering the same app replaces rather than duplicates', () => {
    registerReferenceScanner(scanner('issues'))
    registerReferenceScanner(scanner('issues'))
    expect(registeredScannerApps()).toEqual(['issues'])
  })
})

describe('a second app keeps a file alive', () => {
  it('reports the file as referenced when only the OTHER app references it', async () => {
    registerReferenceScanner(scanner('issues', { references: false }))
    registerReferenceScanner(scanner('sales', { references: true }))

    expect(await isUrlReferencedAnywhere(fakeDb(['issues', 'sales']), FILE)).toBe(true)
  })

  it('REFUSES to delete a file the other app still references', async () => {
    registerReferenceScanner(scanner('issues', { references: false }))
    registerReferenceScanner(scanner('sales', { references: true }))

    await sweepOrphanedUrls(fakeDb(['issues', 'sales']), [FILE])

    expect(del).not.toHaveBeenCalled()
  })

  it('attributes each reference to the app that reported it', async () => {
    registerReferenceScanner(
      scanner('issues', { refs: [{ type: 'issue', id: 7, seq: 42, label: 'Crash', trashed: false }] })
    )
    registerReferenceScanner(
      scanner('sales', { refs: [{ type: 'quote', id: 3, seq: 9, label: 'Q-9', trashed: false }] })
    )

    const map = await computeWorkspaceReferences(fakeDb(['issues', 'sales']), 1)
    expect(map.get(FILE)?.map((r) => `${r.app}:${r.type}`).sort()).toEqual([
      'issues:issue',
      'sales:quote',
    ])
  })
})

// ---------------------------------------------------------------------------
// PHASE 8 — the second admissible proof
// ---------------------------------------------------------------------------
// A deployment cannot register another app's scanner, so Phase 7's registry
// would have blocked every delete the moment a second app existed. Phase 8 lets
// an app be answered for through `platform.blob_references` instead. These tests
// are about that not having loosened the gate: the index is a proof an app has
// to have EARNED (by declaring `maintains_blob_index`), and its absence is still
// an error rather than a `false`.
describe('an app answered for by the index', () => {
  const sales = { slug: 'sales', maintains_blob_index: true }

  it('is covered without a scanner — no error', async () => {
    registerReferenceScanner(scanner('issues', { references: false }))
    await expect(isUrlReferencedAnywhere(fakeDb(['issues', sales]), FILE)).resolves.toBe(false)
  })

  it('keeps the file alive when only ITS index rows point at it', async () => {
    registerReferenceScanner(scanner('issues', { references: false }))
    const db = fakeDb(['issues', sales], { [FILE]: ['sales'] })

    expect(await isUrlReferencedAnywhere(db, FILE)).toBe(true)
    await sweepOrphanedUrls(db, [FILE])
    expect(del).not.toHaveBeenCalled()
  })

  it('still deletes a file no app — scanned or indexed — points at', async () => {
    registerReferenceScanner(scanner('issues', { references: false }))
    await sweepOrphanedUrls(fakeDb(['issues', sales]), [FILE])
    expect(del).toHaveBeenCalledWith(FILE)
  })

  it('does NOT cover an app that has not declared the index', async () => {
    // The whole point: `maintains_blob_index: false` is Phase 7's behaviour,
    // unchanged. If this ever starts resolving instead of rejecting, the gate
    // has been loosened and files can be deleted on an unproven answer.
    registerReferenceScanner(scanner('issues', { references: false }))
    const db = fakeDb(['issues', { slug: 'sales', maintains_blob_index: false }])

    await expect(isUrlReferencedAnywhere(db, FILE)).rejects.toBeInstanceOf(ReferenceCoverageError)
    await sweepOrphanedUrls(db, [FILE])
    expect(del).not.toHaveBeenCalled()
  })

  it('prefers a registered scanner over the index for the same app', async () => {
    // Both available: the live scan wins, so a stale index cannot mask a real
    // reference — and `blob-drift` stays meaningful, because the app that can
    // do both is the one that proves the index right for the apps that cannot.
    registerReferenceScanner(scanner('issues', { references: true }))
    const db = fakeDb([{ slug: 'issues', maintains_blob_index: true }], {})

    expect(await isUrlReferencedAnywhere(db, FILE)).toBe(true)
  })

  it('always consults platform-owned content, whatever is registered', async () => {
    // `platform.comments` belongs to no app, so no app's scanner can be trusted
    // to account for it. Even with zero indexed apps, those rows are checked.
    registerReferenceScanner(scanner('issues', { references: false }))
    const db = fakeDb(['issues'], { [FILE]: [PLATFORM_REF_APP] })

    expect(await isUrlReferencedAnywhere(db, FILE)).toBe(true)
    await sweepOrphanedUrls(db, [FILE])
    expect(del).not.toHaveBeenCalled()
  })

  it('lists indexed references alongside scanned ones', async () => {
    registerReferenceScanner(
      scanner('issues', { refs: [{ type: 'issue', id: 7, seq: 42, label: 'Crash', trashed: false }] })
    )
    const map = await computeWorkspaceReferences(fakeDb(['issues', sales], { [FILE]: ['sales'] }), 1)

    expect(map.get(FILE)?.map((r) => `${r.app}:${r.type}`).sort()).toEqual([
      'issues:issue',
      'sales:record',
    ])
  })
})

describe('sweepOrphanedUrls', () => {
  it('keeps the file when a scanner fails', async () => {
    registerReferenceScanner(scanner('issues', { fail: true }))

    // Never throws — a storage hiccup must not fail the user's delete — but the
    // file survives, which is the half that matters.
    await sweepOrphanedUrls(fakeDb(['issues']), [FILE])

    expect(del).not.toHaveBeenCalled()
  })

  it('keeps the file when an enabled app has no scanner', async () => {
    registerReferenceScanner(scanner('issues', { references: false }))

    await sweepOrphanedUrls(fakeDb(['issues', 'sales']), [FILE])

    expect(del).not.toHaveBeenCalled()
  })

  it('deletes a genuine orphan no app references', async () => {
    registerReferenceScanner(scanner('issues', { references: false }))
    registerReferenceScanner(scanner('sales', { references: false }))

    await sweepOrphanedUrls(fakeDb(['issues', 'sales']), [FILE])

    expect(del).toHaveBeenCalledWith(FILE)
  })

  it('ignores empty entries and dedupes', async () => {
    registerReferenceScanner(scanner('issues', { references: false }))

    await sweepOrphanedUrls(fakeDb(['issues']), [FILE, FILE, null, undefined, ''])

    expect(del).toHaveBeenCalledTimes(1)
  })
})
