// `DELETE …/objections/{oid}` — the confirmation guard that was not one.
//
// ===========================================================================
// WHAT THIS FILE IS ACTUALLY ABOUT
// ===========================================================================
// Until 2026-08-07 the route did this:
//
//     const row = await deleteObjection(…)          // gone
//     if (confirm !== row.type) throw Errors.conflict(…)
//
// A caller who named the wrong type got a 409 telling them so — **and the
// objection was already permanently destroyed.** `sales.objections` has no
// `deleted_at` and no recycle bin, so this is the one operation in the app where
// a wrong guess cannot be undone, and it was the one whose guard fired after the
// fact.
//
// The route's own comment called that branch an assertion that "cannot happen".
// It cannot happen for a caller who passes the RIGHT value. It is precisely the
// wrong-value caller the confirmation exists for — CLAUDE.md's table of
// green-but-inert guards, in a shape nobody had catalogued yet: a guard that runs
// in the right order for every case except the one it was written for.
//
// ===========================================================================
// EVERY REFUSAL ASSERTS THAT NOTHING WAS DELETED, NOT THAT A 4xx CAME BACK
// ===========================================================================
// "the route returned 409" is satisfied just as well by the OLD code, which is
// the entire point. `calls.deleted` is what separates the fix from the bug, and
// a version of this file that only checked statuses would have passed against
// the defect it was written for.
//
// Watched fail on 2026-08-07, three ways (D-26):
//   1. restore the old order — delete first, compare after. The status
//      assertions stayed GREEN; only `calls.deleted` went red. That is the pair
//      working, and it is why the status assertions alone are not the test.
//   2. drop the `confirm !== existing.type` branch entirely — the mismatch case
//      returns 200 and deletes.
//   3. STEP 3, "what would this still pass on?": a route that reads the
//      objection, refuses correctly, and then deletes a DIFFERENT id. Injected
//      by hardcoding `deleteObjection(…, 999, …)`; the premise assertion at the
//      bottom caught it, because it pins the id that was destroyed rather than
//      counting calls.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/unused'
  process.env.PLATFORM_DB_DRIVER = 'pg'
})

const OBJECTION = {
  id: 41,
  prospect_id: 991,
  workspace_id: 3,
  type: 'pricing',
  raised_by: 'Marc Roches',
  status: 'open',
  spoken: 'It is more than we budgeted.',
  real_fear: 'They think it will not be used.',
  counter: null,
}

// Cleared per case; `everDeleted` is not, so the premise assertion can ask a
// question no per-case counter can answer.
const calls = vi.hoisted(() => ({ deleted: [] as number[], everDeleted: [] as number[] }))

vi.mock('@/lib/db/queries/prospect-children', () => ({
  prospectIdBySeq: async (_ws: number, seq: number) => (seq === 12 ? OBJECTION.prospect_id : null),
  getObjection: async (prospectId: number, id: number) =>
    prospectId === OBJECTION.prospect_id && id === OBJECTION.id ? OBJECTION : null,
  deleteObjection: async (
    _ws: number,
    _prospectId: number,
    objectionId: number,
    confirmType: string
  ) => {
    calls.deleted.push(objectionId)
    calls.everDeleted.push(objectionId)
    // The real one refuses a mismatch inside its transaction. Mirrored here so
    // this file cannot pass by mocking away the second half of the guard.
    if (confirmType !== OBJECTION.type) return { status: 'mismatch', type: OBJECTION.type }
    return { status: 'deleted', row: OBJECTION }
  },
  updateObjection: async () => null,
}))

vi.mock('@/lib/actor', () => ({
  resolveActor: async () => ({ userId: 7, tokenId: 3, label: 'Companion' }),
}))

vi.mock('@/lib/db/client', () => ({ getDb: () => ({}) }))

vi.mock('@/lib/api', async () => {
  const { createApiHandler } = await import('@blackcode/platform-api')
  const ctx = {
    appSlug: 'sales',
    db: {} as never,
    resolveUser: async () => ({ id: 7, email: 'a@b.test' }) as never,
    redactBody: true,
  }
  return {
    apiHandler: createApiHandler(ctx as never),
    resolveWorkspace: async () => ({
      user: { id: 7, email: 'a@b.test', name: 'Bala' },
      workspace: { id: 3, slug: 'blackcode', name: 'Blackcode' },
      role: 'owner',
    }),
  }
})

import { DELETE } from '@/app/api/workspaces/[ws]/prospects/[n]/objections/[oid]/route'

function del(
  query: string,
  oid = String(OBJECTION.id)
): [NextRequest, { params: Promise<{ ws: string; n: string; oid: string }> }] {
  return [
    new NextRequest(`https://sales.test/api/workspaces/blackcode/prospects/12/objections/${oid}${query}`, {
      method: 'DELETE',
    }),
    { params: Promise.resolve({ ws: 'blackcode', n: '12', oid }) },
  ]
}

describe('DELETE …/objections/{oid} — the confirmation runs BEFORE the delete', () => {
  beforeEach(() => {
    calls.deleted.length = 0
  })

  it('refuses with no ?confirm, names the type, and destroys nothing', async () => {
    const res = await DELETE(...del(''))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('confirm_required')
    // Without the value in the hint an agent has no way forward: the type is not
    // in the URL and there is nothing else to guess from.
    expect(body.suggestion).toContain(OBJECTION.type)
    expect(calls.deleted, 'the route refused AND destroyed the row').toEqual([])
  })

  it('refuses a WRONG ?confirm and destroys nothing — THE case the old code failed', async () => {
    const res = await DELETE(...del('?confirm=timing'))
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.code).toBe('confirm_mismatch')
    expect(body.suggestion).toContain(OBJECTION.type)
    expect(body.suggestion).toContain('nothing was removed')
    // The assertion the old implementation fails. It returned this same 409.
    expect(calls.deleted, 'a wrong --confirm destroyed the objection anyway').toEqual([])
  })

  it('404s on an id that is not there, without reaching the delete', async () => {
    const res = await DELETE(...del('?confirm=pricing', '9999'))
    expect(res.status).toBe(404)
    expect(calls.deleted).toEqual([])
  })

  it('destroys it on the right type, and reports what it said', async () => {
    const res = await DELETE(...del('?confirm=' + OBJECTION.type))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(calls.deleted).toEqual([OBJECTION.id])
    // The row is gone, so the response is the last chance anybody has to see
    // what it said. A `{ deleted: true }` alone would be a permanent loss with
    // no receipt.
    expect(body).toMatchObject({
      deleted: true,
      type: 'objection',
      id: OBJECTION.id,
      objection_type: OBJECTION.type,
      spoken: OBJECTION.spoken,
    })
  })

  it('THE PREMISE: this route can destroy an objection, and only the right one', () => {
    // Without this, every "destroys nothing" assertion above would pass against
    // a route whose DELETE handler had been removed — and against one that
    // deletes the wrong id, which is why it pins the id rather than the count.
    expect(calls.everDeleted, 'no case in this file ever reached the delete').toEqual([
      OBJECTION.id,
    ])
  })
})
