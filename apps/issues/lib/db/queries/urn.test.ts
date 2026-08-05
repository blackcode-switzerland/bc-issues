// URN format/parse, and this app's mapping from an entity to a URN and a path.
//
// Pure string handling, so these run everywhere — no database, no TEST_DATABASE_URL
// gate. The database half of Phase 6 is in entities.integration.test.ts.
//
// The cases worth having here are the ones where a lenient parser would be
// dangerous rather than merely wrong: a URN that round-trips through
// `bk link create` and into a foreign key must be exactly the string the writer
// produced, so anything ambiguous has to be rejected, not normalised.

import { describe, expect, it } from 'vitest'
import { formatUrn, formatUrnOrNull, isUrn, mustParseUrn, parseUrn } from '@blackcode/platform-db'
import { entityPath, entityUrn, entityUrnOrNull } from '@/lib/entity-address'

describe('formatUrn', () => {
  it('builds the documented shape', () => {
    expect(formatUrn({ app: 'issues', workspaceSlug: 'kali-sa', entityType: 'issue', number: 482 })).toBe(
      'bc:issues:kali-sa/issue/482'
    )
  })

  // `slugify()` never produces an underscore, but nothing constrains
  // `workspaces.slug` at the database level — and a slug the grammar rejected
  // used to throw from inside recordEvent, turning an ordinary delete into a 500.
  it('accepts an underscore in a slug or an entity type', () => {
    expect(
      formatUrn({ app: 'issues', workspaceSlug: 'acme', entityType: 'project_update', number: 1 })
    ).toBe('bc:issues:acme/project_update/1')
    expect(
      formatUrn({ app: 'issues', workspaceSlug: 'trash-123_456', entityType: 'issue', number: 1 })
    ).toBe('bc:issues:trash-123_456/issue/1')
  })

  // The whole point of the #number rule: 0 is not a workspace number, and a
  // non-integer would produce a URN nothing can resolve.
  it('refuses a number that is not a positive integer', () => {
    for (const number of [0, -1, 1.5, NaN]) {
      expect(() =>
        formatUrn({ app: 'issues', workspaceSlug: 'acme', entityType: 'issue', number })
      ).toThrow()
    }
  })
})

// The projection is an index. It must never be able to take down the thing it
// indexes, so every write path formats through the *OrNull variants: a slug that
// cannot appear in a URN costs a projection row (which the reconciler then
// reports as missing), not a failed create/update/delete.
describe('the fail-soft variants used on write paths', () => {
  it('return null where the strict version throws', () => {
    const bad = { app: 'issues', workspaceSlug: 'Not A Slug', entityType: 'issue', number: 1 }
    expect(() => formatUrn(bad)).toThrow()
    expect(formatUrnOrNull(bad)).toBeNull()

    expect(() => entityUrn('Not A Slug', 'issue', 1)).toThrow()
    expect(entityUrnOrNull('Not A Slug', 'issue', 1)).toBeNull()
  })

  it('still return the URN when the components are fine', () => {
    expect(entityUrnOrNull('kali-sa', 'issue', 482)).toBe('bc:issues:kali-sa/issue/482')
  })
})

describe('parseUrn', () => {
  it('round-trips what formatUrn produces', () => {
    const parts = { app: 'issues', workspaceSlug: 'kali-sa', entityType: 'task', number: 7 }
    expect(parseUrn(formatUrn(parts))).toEqual(parts)
  })

  it('tolerates surrounding whitespace, because CLI arguments carry it', () => {
    expect(parseUrn('  bc:issues:acme/issue/3  ')).toEqual({
      app: 'issues',
      workspaceSlug: 'acme',
      entityType: 'issue',
      number: 3,
    })
  })

  it('returns null rather than throwing, so callers can answer 400', () => {
    const bad = [
      '',
      'kali-sa/issue/482', // no scheme
      'xx:issues:acme/issue/1', // wrong scheme
      'bc:issues:acme/issue', // no number
      'bc:issues:acme/issue/1/2', // too many segments
      'bc:issues:acme/issue/abc', // number is not a number
      'bc:issues:acme/issue/0', // 0 is not a workspace #number
      'bc::acme/issue/1', // empty app
      'bc:issues:/issue/1', // empty slug
      'bc:issues:ACME/issue/1', // slugs are lower-case
      'bc:issues:acme/Issue/1',
      'https://issues.blackcode.ch/dashboard/acme/issues/1', // a URL, not a URN
    ]
    for (const s of bad) {
      expect(parseUrn(s), s).toBeNull()
      expect(isUrn(s), s).toBe(false)
    }
  })

  it('mustParseUrn throws for callers that already validated', () => {
    expect(() => mustParseUrn('nope')).toThrow(/not a Blackcode URN/)
  })
})

describe("this app's entity addresses", () => {
  it('uses the workspace #number, never a row id', () => {
    expect(entityUrn('kali-sa', 'issue', 482)).toBe('bc:issues:kali-sa/issue/482')
    expect(entityUrn('kali-sa', 'task', 7)).toBe('bc:issues:kali-sa/task/7')
    expect(entityUrn('kali-sa', 'project', 3)).toBe('bc:issues:kali-sa/project/3')
  })

  // These paths must match app/dashboard/[ws]/{issues,tasks,projects}/[seq].
  // If a route moves, this test is what says the projection's `url` moved too.
  it('points at the real dashboard routes', () => {
    expect(entityPath('kali-sa', 'issue', 482)).toBe('/dashboard/kali-sa/issues/482')
    expect(entityPath('kali-sa', 'task', 7)).toBe('/dashboard/kali-sa/tasks/7')
    expect(entityPath('kali-sa', 'project', 3)).toBe('/dashboard/kali-sa/projects/3')
  })
})
