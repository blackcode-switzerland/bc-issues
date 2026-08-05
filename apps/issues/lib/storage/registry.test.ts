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

// A db stand-in. The only statement whose result is read here is the enabled-app
// query, so it answers every statement with those rows; the ledger delete
// ignores what it gets back.
function fakeDb(enabledApps: string[]): Executor {
  return {
    async execute() {
      return { rows: enabledApps.map((slug) => ({ slug })) }
    },
  }
}

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
