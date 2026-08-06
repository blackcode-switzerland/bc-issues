// The platform/app event seam — D-23, settled 2026-08-06.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE IS GUARDING, AND WHY A TEST IS NEEDED AT ALL
// ---------------------------------------------------------------------------
// `recordPlatformEvent` writes `platform.events.app` from a parameter, and the
// value "falls out of" the app passing its own slug. That is exactly the kind of
// correctness that survives until somebody simplifies it — a literal `'issues'`
// inside the shared recorder is a one-word change that breaks nothing today,
// passes every other test in this repo, and quietly files every workspace the
// sales deployment creates under the issues app forever.
//
// So there are three separate claims here, and they fail for different reasons:
//
//   1. THE RECORDER writes the app it was GIVEN. Asserted with two different
//      slugs, because an assertion that only ever checks one value is satisfied
//      just as well by a hardcoded constant.
//   2. THE WIRING passes THIS APP's `APP_SLUG` rather than a literal that
//      happens to match it. `@/lib/app` is mocked to a slug that is not
//      "issues", so a hardcoded literal in the delegation goes red — which the
//      obvious version of this test (assert it says "issues") would not catch,
//      because "issues" is what a hardcoded literal says too.
//   3. THE SEAM RUNS ONE WAY. Each of the five platform actions must fan out
//      from `recordPlatformEvent` and NOT from the app's `fanOutEvent`. A case
//      re-added to the app's switch delivers every one of those notifications
//      twice, and nothing else in the suite would notice.
//
// No database. The transaction handle is a fake that records what was inserted —
// which is the whole observable surface of a write path that returns nothing to
// its caller.

import { describe, expect, it, vi } from 'vitest'

// The delegation reads APP_SLUG. Mocking it to something that is NOT this app's
// real slug is the point of case (2) — see the header.
const TEST_APP_SLUG = vi.hoisted(() => 'some-other-app')
vi.mock('@/lib/app', () => ({ APP_SLUG: TEST_APP_SLUG, APP_NAME: 'Test App' }))

// The query modules below import the app's Drizzle client at module scope, and
// `createDb` throws when DATABASE_URL is unset. Hoisted, because ES imports are
// evaluated before any statement in this file. A localhost URL is enough:
// node-postgres builds its Pool lazily and nothing here opens a connection —
// every query goes through the fake handle below.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/unused'
  process.env.PLATFORM_DB_DRIVER = 'pg'
})

import { events, inboxMessages } from '@/lib/db/schema'
import { recordPlatformEvent } from '@blackcode/platform-db'
import { recordEvent } from './events'
import { fanOutEvent } from './fanout'

type Row = Record<string, unknown>

interface Captured {
  events: Row[]
  inbox: Row[]
}

/**
 * Every field any fan-out handler reads off a looked-up row, in one object.
 *
 * ── WHY READS MUST RETURN SOMETHING ─────────────────────────────────────────
 * The first version of this fake answered every read with `[]`. It was tidier,
 * and it made the whole "the app's switch wrote nothing" half of this file
 * INERT: every handler opens with a lookup and bails politely when it comes back
 * empty, so a platform action wired straight back into the app's switch would
 * still have written nothing and every assertion would still have been green.
 * Found by injecting the regression and watching the suite stay green, which is
 * the only way that class of mistake ever surfaces.
 *
 * So reads return a plausible row, and every case below asserts its own premise
 * — that the PLATFORM recorder does write for the same fixture. "Nobody wrote
 * anything" and "the right side wrote it" are then two different results.
 */
const LOOKED_UP_ROW: Row = {
  id: 77,
  user_id: 77,
  owner_id: 77,
  name: 'Test Workspace',
  token: 'inv_tok',
  reporter_id: 77,
  seq: 3,
  title: 'x',
}

function makeTx(): { tx: never; captured: Captured } {
  const captured: Captured = { events: [], inbox: [] }

  const chain = (resolve: () => Row[]) => {
    const c: Record<string, unknown> = {}
    for (const method of ['from', 'where', 'orderBy', 'limit', 'leftJoin', 'set', 'returning']) {
      c[method] = () => c
    }
    c.then = (ok: (v: Row[]) => unknown, fail?: (e: unknown) => unknown) =>
      Promise.resolve().then(resolve).then(ok, fail)
    return c
  }

  const insert = (table: unknown) => {
    const sink = table === events ? captured.events : table === inboxMessages ? captured.inbox : null
    if (!sink) throw new Error('the fake tx was handed an unexpected table to insert into')
    let values: Row = {}
    const c = chain(() => [{ id: sink.length + 1, ...values }])
    c.values = (v: Row) => {
      values = v
      sink.push(v)
      return c
    }
    return c
  }

  // A read of `inbox_messages` is createInboxMessage's 60-second dedup probe,
  // and it must come back empty. Otherwise every write takes the UPDATE branch
  // and this fake counts zero inserts while the code under test works perfectly.
  const select = () => {
    const c = chain(() => [LOOKED_UP_ROW])
    c.from = (table: unknown) => (table === inboxMessages ? chain(() => []) : c)
    return c
  }

  const tx = {
    insert,
    select,
    update: () => chain(() => []),
    delete: () => chain(() => []),
    // The two raw statements either half runs, answered by one row: who sent an
    // invitation (fanOutInvitationAccepted), and the workspace slug + #number
    // this app's `resolveSubjectUrn` builds a URN out of.
    execute: async () => ({
      rows: [
        { invited_by: 55, email: 'inviter@example.test', slug: 'test-workspace', seq: 3 },
      ] as Row[],
    }),
  }
  return { tx: tx as unknown as never, captured }
}

describe('recordPlatformEvent writes the PRODUCING app', () => {
  it('records the app it was given — and a different app gives a different answer', async () => {
    const a = makeTx()
    await recordPlatformEvent(a.tx, {
      app: 'sales',
      workspaceId: 1,
      actorUserId: 9,
      entityType: 'workspace',
      entityId: 1,
      action: 'created',
    })

    const b = makeTx()
    await recordPlatformEvent(b.tx, {
      app: 'issues',
      workspaceId: 1,
      actorUserId: 9,
      entityType: 'workspace',
      entityId: 1,
      action: 'created',
    })

    expect(a.captured.events[0].app).toBe('sales')
    expect(b.captured.events[0].app).toBe('issues')
    // THE PREMISE OF THE TWO ABOVE. If `app` were hardcoded, both would say the
    // same thing, and each assertion on its own would still look like it had
    // checked something.
    expect(
      a.captured.events[0].app,
      'both calls produced the same `app`, so this test cannot tell a parameter ' +
        'from a hardcoded constant. platform.events.app must be the app that WROTE ' +
        'the event — a workspace created from the sales host is a sales event.'
    ).not.toBe(b.captured.events[0].app)
  })

  it('leaves subject_urn null — the answer, not a gap', async () => {
    const { tx, captured } = makeTx()
    await recordPlatformEvent(tx, {
      app: 'sales',
      workspaceId: 1,
      entityType: 'invitation',
      entityId: 4,
      action: 'invitation_revoked',
    })
    expect(captured.events[0].subject_urn).toBeNull()
  })

  it('refuses an app-owned entity type rather than filing it as platform', async () => {
    const { tx } = makeTx()
    await expect(
      recordPlatformEvent(tx, {
        app: 'issues',
        workspaceId: 1,
        entityType: 'issue' as never,
        entityId: 4,
        action: 'created',
      })
    ).rejects.toThrow(/not a platform entity type/)
  })

  it('refuses an empty app rather than writing an unattributed event', async () => {
    const { tx } = makeTx()
    await expect(
      recordPlatformEvent(tx, {
        app: '',
        workspaceId: 1,
        entityType: 'workspace',
        entityId: 1,
        action: 'created',
      })
    ).rejects.toThrow(/requires `app`/)
  })
})

describe("THE WIRING: this app's recordEvent delegates with its OWN slug", () => {
  it('a platform entity type carries APP_SLUG, not a literal', async () => {
    const { tx, captured } = makeTx()
    await recordEvent(tx, {
      workspaceId: 1,
      actorUserId: 9,
      entityType: 'workspace_member',
      entityId: 5,
      action: 'member_added',
    })

    expect(
      captured.events[0].app,
      "the delegation must pass this app's APP_SLUG. A literal 'issues' here " +
        'reads as correct in this repo and mis-files every event in the next app ' +
        'that copies this file.'
    ).toBe(TEST_APP_SLUG)
    expect(captured.events[0].subject_urn).toBeNull()
  })

  it("an app entity type still goes through this app's own recorder", async () => {
    const { tx, captured } = makeTx()
    await recordEvent(tx, {
      workspaceId: 1,
      actorUserId: 9,
      entityType: 'issue',
      entityId: 42,
      action: 'status_changed',
      meta: { seq: 7, title: 'x' },
    })
    expect(captured.events).toHaveLength(1)
    expect(captured.events[0].app).toBe(TEST_APP_SLUG)
    // The discriminator: the app half RESOLVES a subject URN, and for an issue
    // that resolves to one. The platform half hardcodes null.
    expect(
      captured.events[0].subject_urn,
      'an issue event went down the platform path — subject_urn was not resolved'
    ).not.toBeNull()
  })

  it('rejects coalescing on a platform event instead of dropping it silently', async () => {
    const { tx } = makeTx()
    await expect(
      recordEvent(tx, {
        workspaceId: 1,
        actorUserId: 9,
        entityType: 'workspace',
        entityId: 1,
        action: 'updated',
        coalesceWindowMs: 60_000,
      })
    ).rejects.toThrow(/platform entity type/)
  })
})

describe('THE SEAM: platform actions fan out from platform-db, and not from the app', () => {
  // meta carries what all five handlers read, so one fixture drives every case.
  const META = {
    email: 'invitee@example.test',
    previous_owner_user_id: 55,
    new_owner_user_id: 66,
    // fanOutAssigned's field. Present so that an app handler wired to a platform
    // action WOULD write — otherwise the injected regression bails early and the
    // assertion below passes for the wrong reason.
    assignee_id: 77,
  }

  const CASES = [
    { action: 'invitation_created', entityType: 'invitation' },
    { action: 'member_added', entityType: 'workspace_member' },
    { action: 'member_removed', entityType: 'workspace_member' },
    { action: 'ownership_transferred', entityType: 'workspace' },
    { action: 'invitation_accepted', entityType: 'invitation' },
  ] as const

  it.each(CASES)('$action', async ({ action, entityType }) => {
    // THE PREMISE: the platform side really does notify somebody for this
    // fixture. Without it, "the app wrote nothing" is satisfied by a fixture no
    // handler acts on at all.
    const platform = makeTx()
    await recordPlatformEvent(platform.tx, {
      app: 'issues',
      workspaceId: 1,
      actorUserId: 9,
      entityType,
      entityId: 5,
      action,
      meta: META,
    })
    expect(
      platform.captured.inbox.length,
      `recordPlatformEvent wrote no inbox row for '${action}'. Either the platform ` +
        'fan-out lost this case, or this fixture no longer reaches it — in which ' +
        'case the assertion below is checking nothing.'
    ).toBeGreaterThan(0)

    const app = makeTx()
    await fanOutEvent(app.tx, {
      id: 1,
      workspace_id: 1,
      app: TEST_APP_SLUG,
      actor_user_id: 9,
      entity_type: entityType,
      entity_id: 5,
      action,
      meta: META,
    } as never)
    expect(
      app.captured.inbox,
      `the app's fanOutEvent handled '${action}'. recordPlatformEvent already fans ` +
        'this out, so a case here means every one of these notifications is ' +
        'delivered twice.'
    ).toHaveLength(0)
  })

  it("THE OTHER PREMISE: the app's fan-out still works for its own actions", async () => {
    const { tx, captured } = makeTx()
    await fanOutEvent(tx, {
      id: 1,
      workspace_id: 1,
      app: TEST_APP_SLUG,
      actor_user_id: 9,
      entity_type: 'issue',
      entity_id: 5,
      action: 'assigned',
      meta: META,
    } as never)
    expect(
      captured.inbox,
      "fanOutEvent wrote nothing for one of this app's OWN actions, so the five " +
        'cases above would be green even if it were broken outright.'
    ).toHaveLength(1)
  })
})
