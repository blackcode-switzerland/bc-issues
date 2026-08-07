// Actor attribution: what goes in the `_label` column beside the user FK.
//
// The interesting case is the AMBIGUOUS one, and it is why this file exists.
// `platform.api_tokens.token_prefix` is eight characters, so two of ONE user's
// tokens can share it. `resolveActor` must not pick between them: a confident
// wrong name in an audit trail is worse than a vaguer right one, and this column
// exists precisely to say who did something.
//
// Everything here is a fake `Executor` — one `execute()` returning canned rows.
// The lookup being tested is a single SELECT scoped to the authenticated user,
// so there is nothing a real database would add except a connection.

import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import type { User } from '@blackcode/platform-db'
import { resolveActor } from './actor'

const USER = { id: 7, email: 'andrea@blackcode.ch', name: 'Andrea' } as User

/** A db whose one query returns `rows`, and records that it was asked. */
function fakeDb(rows: Record<string, unknown>[], calls: number[] = []) {
  return {
    async execute() {
      calls.push(1)
      return { rows }
    },
  }
}

function req(auth?: string) {
  return new NextRequest('https://sales.test/api/workspaces/acme/prospects', {
    headers: auth ? { authorization: auth } : {},
  })
}

describe('resolveActor', () => {
  it('labels a token request with the TOKEN name, not the user name', async () => {
    const actor = await resolveActor(
      fakeDb([{ id: 42, name: 'Companion' }]),
      req('Bearer bk_live_abcd1234rest'),
      USER
    )
    // This is the whole feature: agent-written history stays visibly
    // agent-written (docs/backend.md §3.4).
    expect(actor).toEqual({ userId: 7, tokenId: 42, label: 'Companion' })
  })

  it('falls back to the user for a session request, and asks the database nothing', async () => {
    const calls: number[] = []
    const actor = await resolveActor(fakeDb([], calls), req(), USER)
    expect(actor).toEqual({ userId: 7, tokenId: null, label: 'Andrea' })
    // No Authorization header means no token to identify, so a query would be a
    // round trip per write for an answer that is already known.
    expect(calls.length, 'a session request must not query api_tokens').toBe(0)
  })

  it('REFUSES TO GUESS when two of the user\'s tokens share a prefix', async () => {
    const actor = await resolveActor(
      fakeDb([
        { id: 42, name: 'Companion' },
        { id: 43, name: 'CI runner' },
      ]),
      req('Bearer bk_live_abcd1234rest'),
      USER
    )
    // Not "the first one". Either could be the credential that authenticated
    // this request, and a history row saying "Companion" when it was the CI
    // runner is a lie nobody can detect afterwards.
    expect(actor).toEqual({ userId: 7, tokenId: null, label: 'Andrea' })
  })

  it('falls back on a token with no name, rather than labelling a row empty', async () => {
    const actor = await resolveActor(
      fakeDb([{ id: 42, name: '   ' }]),
      req('Bearer bk_live_abcd1234rest'),
      USER
    )
    expect(actor.label).toBe('Andrea')
    // The token id is still recorded — WHICH credential was used is known even
    // when what to call it is not.
    expect(actor.tokenId).toBe(42)
  })

  it('never throws: a database failure costs a label, not the write', async () => {
    const exploding = {
      async execute() {
        throw new Error('connection reset')
      },
    }
    const actor = await resolveActor(exploding, req('Bearer bk_live_abcd1234rest'), USER)
    expect(actor).toEqual({ userId: 7, tokenId: null, label: 'Andrea' })
  })

  it('uses the email when the user has no name', async () => {
    const actor = await resolveActor(fakeDb([]), req(), { ...USER, name: null } as User)
    // Never empty. An attribution column that can hold '' has a state meaning
    // "nobody", which is not a thing that can write a row.
    expect(actor.label).toBe('andrea@blackcode.ch')
  })

  it('ignores a bearer token that is not one of ours, and a truncated prefix', async () => {
    const calls: number[] = []
    for (const header of ['Bearer github_pat_xxx', 'Bearer bk_live_abc']) {
      const actor = await resolveActor(fakeDb([{ id: 1, name: 'X' }], calls), req(header), USER)
      expect(actor.tokenId, `${header} must not be looked up`).toBeNull()
    }
    expect(calls.length, 'neither shape should reach the database').toBe(0)
  })
})
