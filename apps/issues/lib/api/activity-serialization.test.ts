// The activity feed must serialize byte-identically after the Class-B move.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A FROZEN COPY AND NOT A LIVE DIFF
// ---------------------------------------------------------------------------
// The ask was "capture one real activity response before and after and diff
// them". There is no database in this suite, so the diff is done one layer down
// and made permanent instead of one-off: `LEGACY_PUBLIC_EVENT` below is the
// pre-move implementation, copied verbatim from
// `apps/issues/lib/api/serialize.ts` as it stood on 2026-08-06, and the shared
// factory's serializer is asserted to agree with it on every row of a page built
// to contain each case that behaves differently.
//
// A frozen copy is better than a captured response here, because a captured
// response only proves the two agreed on the rows that happened to exist that
// day. This one names the cases:
//
//   - a numbered entity present in the seq map        → #number
//   - a numbered entity ABSENT from the map, with     → meta.seq
//     meta.seq (a purged row)
//   - a numbered entity absent with no meta.seq       → null, NEVER the serial
//   - a non-numbered app entity (comment, label)      → its own id, untouched
//   - a platform entity (workspace, member, invite)   → untouched
//   - entity_id null                                  → untouched
//
// The third case is the one that matters most: an internal serial reaching an
// agent ends up in a script, and then it is a contract.
//
// DELETE THIS FILE only when the legacy copy stops being meaningful — i.e. when
// the shape deliberately changes and this test is updated in the same commit
// with a changelog entry saying so.
import { describe, expect, it } from 'vitest'
import { publicEventIds as publicEvent } from '@blackcode/platform-api/routes'

/** The pre-move implementation, verbatim. Do not "improve" it. */
type Row = Record<string, unknown>
function LEGACY_PUBLIC_EVENT(input: object, seqMap: Map<string, number>): Row {
  const row = input as Row
  const type = row.entity_type as string
  const eid = row.entity_id as number | null
  if ((type === 'issue' || type === 'task' || type === 'project') && eid != null) {
    const meta = row.meta as { seq?: number } | null
    return { ...row, entity_id: seqMap.get(`${type}:${eid}`) ?? meta?.seq ?? null }
  }
  return row
}

/** Exactly what apps/issues passes to the factory. */
const NUMBERED = new Set(['issue', 'task', 'project'])

const event = (over: Row): Row => ({
  id: 1,
  workspace_id: 3,
  app: 'issues',
  subject_urn: null,
  actor_user_id: 9,
  actor_token_id: null,
  entity_type: 'issue',
  entity_id: 4210,
  action: 'created',
  diff: null,
  meta: null,
  idempotency_key: null,
  occurred_at: new Date('2026-08-05T09:00:00Z'),
  actor_name: 'Ada',
  actor_email: 'ada@example.test',
  ...over,
})

const PAGE: Row[] = [
  // numbered, in the map
  event({ id: 1, entity_type: 'issue', entity_id: 4210 }),
  event({ id: 2, entity_type: 'task', entity_id: 88 }),
  event({ id: 3, entity_type: 'project', entity_id: 12 }),
  // numbered, purged — falls back to meta.seq
  event({ id: 4, entity_type: 'issue', entity_id: 9999, meta: { seq: 77 } }),
  // numbered, purged, no meta.seq — must be null, never 9998
  event({ id: 5, entity_type: 'issue', entity_id: 9998 }),
  // app entities that keep their own id
  event({ id: 6, entity_type: 'comment', entity_id: 501, action: 'commented' }),
  event({ id: 7, entity_type: 'label', entity_id: 22, action: 'labeled' }),
  event({ id: 8, entity_type: 'attachment', entity_id: 31, action: 'attached' }),
  // platform entities
  event({ id: 9, entity_type: 'workspace', entity_id: 3, action: 'updated' }),
  event({ id: 10, entity_type: 'workspace_member', entity_id: 9, action: 'member_added' }),
  event({ id: 11, entity_type: 'invitation', entity_id: 4, action: 'invitation_created' }),
  event({
    id: 12,
    entity_type: 'workspace_app',
    entity_id: 3,
    action: 'app_access_granted',
    meta: { app: 'sales' },
  }),
  // null entity_id
  event({ id: 13, entity_type: 'issue', entity_id: null as unknown as number }),
]

const SEQ_MAP = new Map<string, number>([
  ['issue:4210', 482],
  ['task:88', 15],
  ['project:12', 3],
])

describe('activity feed serialization is unchanged by the Class-B move', () => {
  it('THE PREMISE: the page exercises rows the two could disagree on', () => {
    // Without this, "the two agree" is satisfied by a page of rows neither one
    // touches — the same vacuous pass the parity guard's input assertions exist
    // to prevent.
    const rewritten = PAGE.filter(
      (r) => LEGACY_PUBLIC_EVENT(r, SEQ_MAP).entity_id !== r.entity_id
    )
    expect(
      rewritten.map((r) => r.id),
      'no row in the fixture is rewritten by the serializer at all'
    ).toEqual([1, 2, 3, 4, 5])
  })

  it('every row serializes identically', () => {
    const before = PAGE.map((r) => LEGACY_PUBLIC_EVENT(r, SEQ_MAP))
    const after = PAGE.map((r) => publicEvent(r, SEQ_MAP, NUMBERED))
    // JSON, not toEqual: this is the wire format, and the question is whether a
    // client sees the same bytes.
    expect(JSON.stringify(after, null, 2)).toBe(JSON.stringify(before, null, 2))
  })

  it('never exposes the internal serial for a purged numbered entity', () => {
    const purged = publicEvent(
      event({ entity_type: 'issue', entity_id: 9998 }),
      SEQ_MAP,
      NUMBERED
    )
    expect(purged.entity_id, 'an internal row id reached the response').toBeNull()
  })
})
