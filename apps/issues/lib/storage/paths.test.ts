// Blob path attribution (Phase 7). The prefix is what keeps a shared store
// sortable and an app extractable, and `assertOwnPathname` is the only thing
// standing between a client-chosen pathname and another app's prefix.

import { describe, it, expect } from 'vitest'
import {
  UNATTRIBUTED_WORKSPACE,
  appFromPathname,
  appPrefix,
  assertPathnameWritable,
  blobPathname,
} from '@blackcode/platform-storage/paths'

// Every app in platform.apps, as the upload handshake passes them.
const KNOWN_APPS = ['issues', 'sales']

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

describe('assertPathnameWritable', () => {
  it('accepts this app’s own prefix', () => {
    expect(() => assertPathnameWritable('issues', 'issues/acme/x.png', KNOWN_APPS)).not.toThrow()
  })

  it('refuses another app’s prefix', () => {
    expect(() => assertPathnameWritable('issues', 'sales/acme/x.png', KNOWN_APPS)).toThrow()
  })

  it('refuses traversal', () => {
    expect(() => assertPathnameWritable('issues', 'issues/../sales/x.png', KNOWN_APPS)).toThrow()
  })

  it('refuses an empty path', () => {
    expect(() => assertPathnameWritable('issues', '   ', KNOWN_APPS)).toThrow()
  })

  // ── THE REGRESSION ────────────────────────────────────────────────────────
  // This check once demanded the prefix, which broke every installed `bk` in
  // production on 2026-08-05: the CLI uses the same client-direct flow as the
  // browser and sends a bare filename (client.go → uploadViaBlob). An old client
  // cannot know a convention that shipped after it did, so an unprefixed path
  // must be accepted — it lands flat at the store root, where every
  // pre-Phase-7 file already is, and `uploads.app` attributes it regardless.
  it('ACCEPTS an unprefixed path — an older client that predates the convention', () => {
    expect(() => assertPathnameWritable('issues', 'phase7-probe.txt', KNOWN_APPS)).not.toThrow()
  })

  it('accepts a first segment that is not an app at all', () => {
    expect(() => assertPathnameWritable('issues', 'holiday photos/x.png', KNOWN_APPS)).not.toThrow()
  })

  it('accepts anything but a foreign prefix when no other app exists yet', () => {
    expect(() => assertPathnameWritable('issues', 'sales/x.png', ['issues'])).not.toThrow()
  })
})
