// Blob path attribution (Phase 7). The prefix is what keeps a shared store
// sortable and an app extractable, and `assertOwnPathname` is the only thing
// standing between a client-chosen pathname and another app's prefix.

import { describe, it, expect } from 'vitest'
import {
  UNATTRIBUTED_WORKSPACE,
  appFromPathname,
  appPrefix,
  assertOwnPathname,
  blobPathname,
} from '@blackcode/platform-storage/paths'

describe('blobPathname', () => {
  it('writes under <app>/<workspace>/<file>', () => {
    expect(blobPathname('issues', 'acme', '1712-report.pdf')).toBe('issues/acme/1712-report.pdf')
  })

  it('falls back to the unattributed folder when there is no workspace', () => {
    expect(blobPathname('issues', null, 'x.png')).toBe(`issues/${UNATTRIBUTED_WORKSPACE}/x.png`)
    expect(blobPathname('issues', '', 'x.png')).toBe(`issues/${UNATTRIBUTED_WORKSPACE}/x.png`)
  })

  it('never lets a segment introduce a directory of its own', () => {
    expect(blobPathname('issues', 'a/b', 'c/d.png')).toBe('issues/a_b/c_d.png')
  })

  it('produces a path the server will accept even from hostile segments', () => {
    // Whatever the input, the result must have exactly three segments and no
    // traversal — assertOwnPathname refuses anything else, and an upload that
    // builds a path its own server rejects is a broken upload.
    for (const ws of ['../..', '..', './..', 'a\\b']) {
      const path = blobPathname('issues', ws, '..x.png')
      expect(path.startsWith('issues/')).toBe(true)
      expect(path.split('/')).toHaveLength(3)
      expect(path).not.toContain('..')
    }
  })

  it('keeps a normal file extension intact', () => {
    expect(blobPathname('issues', 'acme', 'report.v2.pdf')).toBe('issues/acme/report.v2.pdf')
  })
})

describe('appPrefix / appFromPathname', () => {
  it('round-trips', () => {
    expect(appPrefix('issues')).toBe('issues/')
    expect(appFromPathname('issues/acme/1-x.png')).toBe('issues')
  })

  it('returns null for a pre-Phase-7 file stored flat at the root', () => {
    // Attribution for these comes from platform.uploads.app, which the migration
    // backfilled. Guessing from the path would invent a fact.
    expect(appFromPathname('1712-report.pdf')).toBeNull()
    expect(appFromPathname(null)).toBeNull()
  })
})

describe('assertOwnPathname', () => {
  it('accepts this app’s own prefix', () => {
    expect(() => assertOwnPathname('issues', 'issues/acme/x.png')).not.toThrow()
  })

  it('refuses another app’s prefix', () => {
    expect(() => assertOwnPathname('issues', 'sales/acme/x.png')).toThrow()
  })

  it('refuses an unprefixed path', () => {
    expect(() => assertOwnPathname('issues', 'x.png')).toThrow()
  })

  it('refuses traversal', () => {
    expect(() => assertOwnPathname('issues', 'issues/../sales/x.png')).toThrow()
  })
})
