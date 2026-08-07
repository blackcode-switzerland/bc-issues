// The delete confirmation is a SERVER guard, and this is the test that says so.
//
// ---------------------------------------------------------------------------
// WHY IT IS WORTH A FILE OF ITS OWN
// ---------------------------------------------------------------------------
// CLAUDE.md, *Writing commands agents can survive*: `Confirm()` is not a guard
// for agents, because it auto-approves under `BK_NO_PROMPT=1` and on a non-TTY —
// which is how every agent runs. The guard that works is making the caller
// repeat the target back.
//
// `bk sales prospect delete` does check `--confirm` locally, and that check is
// worth having: it costs no round trip and can name the row. **But a check that
// lives only in the binary is a check the caller can skip** — by shelling out to
// curl, by running last month's binary, or by a web action added in Phase 7 that
// nobody thought to wire it into. So the route enforces it too, and the route is
// what this file tests.
//
// ---------------------------------------------------------------------------
// THE PREMISE, WHICH IS THE HALF THAT ROTS
// ---------------------------------------------------------------------------
// "the route returned 400" is satisfied just as well by a route that returns 400
// and deletes anyway. Every refusal case therefore asserts BOTH: the status, and
// that `softDeleteProspect` was never called. The second assertion is the one
// that matters, and it is the one that would silently stop meaning anything if
// the delete moved behind another function.
//
// Watched fail on 2026-08-07 by removing the confirm check from the route: the
// 400 cases returned 200 and `softDeleteProspect` was called with #12. Then, as
// D-26 step 3 requires, by keeping the `throw` and moving the delete ABOVE it —
// the status assertions stayed green and only the call-count assertions caught
// it, which is exactly the failure they exist for.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.hoisted(() => {
  // The route module imports the db client transitively. Never connected to —
  // every query below is mocked — but `createDb` throws without it at import.
  process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/unused'
  process.env.PLATFORM_DB_DRIVER = 'pg'
})

const PROSPECT = {
  id: 991,
  seq: 12,
  name: 'Fiduciaire Roches SA',
  workspace_id: 3,
  stage: 'contacted',
  deleted_at: null,
}

// `softDelete` is cleared before each case; `everDeleted` is not, so the premise
// assertion at the bottom can ask a question no per-case counter can answer.
const calls = vi.hoisted(() => ({ softDelete: [] as number[], everDeleted: [] as number[] }))

vi.mock('@/lib/db/queries/prospects', () => ({
  getProspectBySeq: async (_ws: number, seq: number) =>
    seq === PROSPECT.seq ? { ...PROSPECT, owner: null, labels: [] } : null,
  softDeleteProspect: async (_ws: number, seq: number) => {
    calls.softDelete.push(seq)
    calls.everDeleted.push(seq)
    return { ...PROSPECT, owner: null, labels: [], deleted_at: new Date() }
  },
  listJourney: async () => [],
  updateProspect: async () => null,
  findUserIdByEmail: async () => null,
}))

vi.mock('@/lib/actor', () => ({
  resolveActor: async () => ({ userId: 7, tokenId: 3, label: 'Companion' }),
}))

vi.mock('@/lib/db/client', () => ({ getDb: () => ({}) }))

vi.mock('@blackcode/platform-db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@blackcode/platform-db')>()),
  listLinks: async () => [],
}))

// `resolveWorkspace` is replaced wholesale: auth and per-app access are not what
// this file is about, and a real one would need a database. `apiHandler` is the
// REAL one, imported from the package — it owns the ApiError → JSON conversion,
// which is precisely the behaviour under test.
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

import { DELETE } from '@/app/api/workspaces/[ws]/prospects/[n]/route'

function del(query: string): [NextRequest, { params: Promise<{ ws: string; n: string }> }] {
  const url = `https://sales.test/api/workspaces/blackcode/prospects/12${query}`
  return [
    new NextRequest(url, { method: 'DELETE' }),
    { params: Promise.resolve({ ws: 'blackcode', n: '12' }) },
  ]
}

describe('DELETE /api/workspaces/{ws}/prospects/{n} — the confirmation is a server guard', () => {
  beforeEach(() => {
    calls.softDelete.length = 0
  })

  it('refuses with no ?confirm, and deletes nothing', async () => {
    const res = await DELETE(...del(''))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('confirm_required')
    // The hint has to name the value, or an agent has no way forward.
    expect(body.suggestion).toContain(PROSPECT.name)
    expect(calls.softDelete, 'the route refused AND deleted').toEqual([])
  })

  it('refuses a WRONG ?confirm, names the company that is actually there, and deletes nothing', async () => {
    const res = await DELETE(...del('?confirm=StaffUp'))
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.code).toBe('confirm_mismatch')
    // The whole recovery: an agent that was operating on the wrong #number
    // learns here which company #12 really is.
    expect(body.suggestion).toContain(PROSPECT.name)
    expect(calls.softDelete, 'the route refused AND deleted').toEqual([])
  })

  it('refuses a confirm that is right for a DIFFERENT prospect', async () => {
    // The realistic agent mistake: it has the name it meant and the number of
    // something else. Neither value is nonsense, and only the pairing is wrong.
    const res = await DELETE(...del('?confirm=' + encodeURIComponent('Clinique Altura')))
    expect(res.status).toBe(409)
    expect(calls.softDelete).toEqual([])
  })

  it('deletes on the right name, and reports WHAT it destroyed', async () => {
    const res = await DELETE(...del('?confirm=' + encodeURIComponent(PROSPECT.name)))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(calls.softDelete).toEqual([PROSPECT.seq])
    // Type, #number and name — captured before the delete. A count alone is the
    // difference between a wrong delete caught in a minute and one found in a
    // month.
    expect(body).toMatchObject({
      deleted: true,
      type: 'prospect',
      number: PROSPECT.seq,
      name: PROSPECT.name,
    })
  })

  it('THE PREMISE: this route can delete at all', () => {
    // Without it, every "deletes nothing" assertion above would pass against a
    // route that can NEVER delete — including one whose DELETE handler was
    // removed by accident. `everDeleted` is deliberately not reset between
    // cases, because the question is about the whole file, not one case.
    // CLAUDE.md's finding #5 is what this exists for.
    expect(calls.everDeleted, 'no case in this file ever reached the delete').toEqual([PROSPECT.seq])
  })
})
