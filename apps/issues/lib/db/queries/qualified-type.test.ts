// The `<app>:<noun>` form, in TypeScript (D-14, migrations 0041/0042).
//
// This file checks the TS SIDE ONLY. The database has its own copy of the same
// rule — the CHECK constraints on `platform.comments.parent_type` and
// `platform.deletion_batches.root_type` — and a duplicated rule that drifts is
// this codebase's recurring silent bug (D-27 trap 2). What ties the two together
// is `qualified-type.integration.test.ts`, which reads the constraint out of
// `pg_constraint` and compares it against `QUALIFIED_TYPE_RE` byte for byte.
//
// Neither file is sufficient alone: this one would pass happily against a
// database whose CHECK had been dropped, and the parity test needs a database.

import { describe, expect, it } from 'vitest'
import { QUALIFIED_TYPE_RE, bareType, qualifyType, typeMatchForms } from '@blackcode/platform-db'
import { ownType, ownTypeForms } from './qualified-type'

// The corpus both this file and the integration test run. Every entry is here
// because it is a shape someone could plausibly write, or has written.
export const TYPE_CORPUS: string[] = [
  // Well-formed.
  'issues:issue',
  'issues:task',
  'issues:project',
  'sales:prospect',
  'sales:communication',
  'a:b',
  'my-app:project_update',
  'app2:thing9',
  // NOT an app we know. Accepted BY DESIGN — the constraint validates the shape,
  // not the registry. Migration 0041's header says why an FK to `platform.apps`
  // is refused; this entry exists so nobody "fixes" it without reading that.
  'nonsense:thing',
  // Bare nouns. The three legacy ones survive until the contract step; any OTHER
  // bare noun is the collision D-14 exists to prevent and must be refused.
  'issue',
  'task',
  'project',
  'prospect',
  'note',
  'report',
  // Malformed.
  'Sales:Prospect',
  'sales:Prospect',
  'sales:',
  ':prospect',
  ':',
  '',
  'sales:pro:spect',
  'sales prospect',
  'sales.prospect',
  '1sales:prospect',
  'sales:9thing',
  '-sales:prospect',
  // Length: 40 + ':' + 40 is the widest legal value (apps.slug +
  // entities.entity_type). One over on either side is not.
  `${'a'.repeat(40)}:${'b'.repeat(40)}`,
  `${'a'.repeat(41)}:b`,
  `a:${'b'.repeat(41)}`,
]

/** The three bare values 0041/0042 still accept. Goes away at the contract step. */
export const LEGACY_BARE = ['issue', 'task', 'project']

/** What the database must say about each corpus entry. */
export function shouldBeAccepted(value: string): boolean {
  return LEGACY_BARE.includes(value) || QUALIFIED_TYPE_RE.test(value)
}

describe('QUALIFIED_TYPE_RE', () => {
  it('accepts <app>:<noun> and nothing else', () => {
    const accepted = TYPE_CORPUS.filter((v) => QUALIFIED_TYPE_RE.test(v))
    expect(accepted).toEqual([
      'issues:issue',
      'issues:task',
      'issues:project',
      'sales:prospect',
      'sales:communication',
      'a:b',
      'my-app:project_update',
      'app2:thing9',
      'nonsense:thing',
      `${'a'.repeat(40)}:${'b'.repeat(40)}`,
    ])
  })

  // The corpus must actually contain both answers. A regex that matched
  // everything, or nothing, would otherwise sail through the assertion above if
  // the expected list were ever regenerated from the implementation.
  it('the corpus exercises both outcomes', () => {
    const yes = TYPE_CORPUS.filter((v) => QUALIFIED_TYPE_RE.test(v)).length
    expect(yes).toBeGreaterThan(5)
    expect(TYPE_CORPUS.length - yes).toBeGreaterThan(5)
  })
})

describe('qualifyType', () => {
  it('composes the stored form', () => {
    expect(qualifyType('sales', 'prospect')).toBe('sales:prospect')
  })

  // A slug the CHECK would refuse must fail HERE, with the offending string in
  // the message — not three frames down as a constraint violation on a write
  // whose transaction has already done other work.
  it('refuses a value the database would refuse', () => {
    expect(() => qualifyType('Sales', 'prospect')).toThrow(/not a valid app-qualified type/)
    expect(() => qualifyType('sales', 'pro:spect')).toThrow(/not a valid app-qualified type/)
    expect(() => qualifyType('', 'prospect')).toThrow(/not a valid app-qualified type/)
  })
})

describe('bareType', () => {
  it('strips the app prefix', () => {
    expect(bareType('issues:issue')).toBe('issue')
    expect(bareType('sales:prospect')).toBe('prospect')
  })

  // Rows written before 0041's backfill, and any write in flight from the
  // previous build, still carry the bare noun. Passing those through unchanged
  // is what lets one code path read both vintages.
  it('passes a legacy bare value through', () => {
    expect(bareType('issue')).toBe('issue')
  })

  it('maps null and undefined to null', () => {
    expect(bareType(null)).toBeNull()
    expect(bareType(undefined)).toBeNull()
  })
})

describe('typeMatchForms', () => {
  it('matches the qualified form AND the legacy bare one', () => {
    expect(typeMatchForms('issues', 'issue')).toEqual(['issues:issue', 'issue'])
  })
})

describe("this app's binding", () => {
  it('pins the slug so no call site can qualify with the wrong app', () => {
    expect(ownType('issue')).toBe('issues:issue')
    expect(ownTypeForms('task')).toEqual(['issues:task', 'task'])
  })

  // Every value this app writes must survive its own round trip: what `ownType`
  // stores has to be what `bareType` gives back to the wire, or the API changes
  // shape without anyone deciding it should.
  it('round-trips every noun this app owns', () => {
    for (const noun of ['issue', 'task', 'project']) {
      expect(bareType(ownType(noun))).toBe(noun)
    }
  })
})
