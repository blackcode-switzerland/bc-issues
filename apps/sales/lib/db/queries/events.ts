// This app's event recorder — the write half of the spine behind `bk activity`.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS AT ALL, WHEN `platform-db` ALREADY WRITES EVENTS
// ---------------------------------------------------------------------------
// `recordPlatformEvent` (@blackcode/platform-db) owns the FOUR platform entity
// types — workspace, workspace_member, workspace_app, invitation — and nothing
// else (D-23). It cannot own a prospect: writing that row needs two things only
// this app has, a `subject_urn` derived from `sales.*`, and a fan-out rule
// written in this app's nouns. So each app carries this recorder and delegates
// the platform half here, in ONE place rather than at every call site.
//
// It is the same split `apps/issues/lib/db/queries/events.ts` describes; read
// that file's header for the reasoning in full. What is written below is only
// what differs for sales.
//
// ---------------------------------------------------------------------------
// THREE DIFFERENCES FROM THE ISSUES RECORDER, EACH DELIBERATE
// ---------------------------------------------------------------------------
// 1. **No fan-out.** `platform.inbox_messages` is fed by watchers, mentions and
//    assignment notifications, and sales has none of them in v1: D-13 removed
//    platform comments from this app, so there is nothing to be mentioned in and
//    nobody watching. A fan-out call here would be a call into a rule set that
//    does not exist. When assignment notifications arrive, they arrive as a
//    `fanout.ts` beside this file — not as a shared one, because "everyone
//    watching this prospect" is this app's sentence.
//
// 2. **No coalescing.** The issues recorder collapses consecutive `updated`
//    events because its web UI autosaves every ~1.2s while a human types. This
//    app is agent-written (the doctrine, `docs/backend.md` §1): writes arrive as
//    discrete commands, one per intent, and merging two of them would merge two
//    decisions. If the Phase 7 web surface ever autosaves prose, add it then,
//    with the window it actually needs.
//
// 3. **`actorTokenId` is populated**, from `lib/actor.ts`. It is a column both
//    apps have and only this one fills, because §3.4's "by Andrea / by
//    Companion" attribution is a validated feature here.
//
// MUST be called inside the transaction that produces the mutation. The database
// has no event triggers, by design — the application layer is the only place an
// event is invented — so a mutation that commits without its event has lost it
// permanently.

import {
  isPlatformEntityType,
  recordPlatformEvent,
  type Event,
  type NewEvent,
  type PlatformEntityType,
  type PlatformEventAction,
  type PlatformTx,
} from '@blackcode/platform-db'
import { events } from '../schema'
import { APP_SLUG } from '@/lib/app'
import { resolveSubjectUrn } from './entities'

/**
 * What an event can be about.
 *
 * The platform half is IMPORTED, never restated (D-23): the same list is what
 * `recordPlatformEvent` accepts and what the shared activity route validates
 * `?entity_type=` against, and that route DROPS an unrecognised filter rather
 * than rejecting it — so a third copy here would fail by silently returning the
 * whole feed.
 *
 * The sales half includes types that are NOT projected into `platform.entities`
 * (`contact`, `stage_entry`, `objection`, `match`). That is not an
 * inconsistency: an event is about something that happened, and "a contact was
 * added to StaffUp" happened whether or not a contact has its own address.
 * Those events simply carry `subject_urn: null` — see `resolveSubjectUrn`.
 */
export type EntityType =
  | PlatformEntityType
  | 'prospect'
  | 'contact'
  | 'stage_entry'
  | 'meeting'
  | 'communication'
  | 'objection'
  | 'product'
  | 'template'
  | 'document'
  | 'match'
  | 'label'

/**
 * What happened.
 *
 * Only actions this app actually writes are listed. A speculative member costs
 * nothing at the type level and quite a lot in a reader's head: it reads as a
 * feature that exists. Adding one when the noun that emits it lands is one line.
 */
export type EventAction =
  | PlatformEventAction
  // prospect (Phase 5)
  | 'stage_changed'
  | 'assigned'
  | 'unassigned'
  | 'next_action_changed'
  | 'labeled'
  | 'unlabeled'
  // the recycle bin
  | 'restored'
  | 'purged'

export interface RecordEventInput {
  workspaceId: number
  actorUserId?: number | null
  actorTokenId?: number | null
  entityType: EntityType
  entityId: number
  action: EventAction
  diff?: { before?: unknown; after?: unknown } | null
  meta?: Record<string, unknown> | null
  idempotencyKey?: string | null
  occurredAt?: Date
  /**
   * Override the cross-app subject address.
   *
   * Leave it unset and `recordEvent` derives it from (entityType, entityId),
   * which is what every call site should do. Pass it explicitly only when the
   * subject row is already gone by the time the event is recorded (a purge),
   * because then there is nothing left to derive it from. Pass `null` to state
   * that this event has no addressable subject.
   */
  subjectUrn?: string | null
}

/**
 * Record one event inside the caller's transaction.
 *
 * `app: APP_SLUG` is what makes `platform.events.app` the PRODUCING app: this
 * deployment is sales, so a workspace created through it is a sales event even
 * though a workspace belongs to no app. Never hardcode a slug at a call site.
 */
export async function recordEvent(tx: PlatformTx, input: RecordEventInput): Promise<Event> {
  // The platform half (D-23), delegated here rather than at the call sites.
  if (isPlatformEntityType(input.entityType)) {
    // Not supported on the platform side, and it would be dropped in silence.
    // No call site passes it today; this exists so the day one does, it says so.
    if (input.subjectUrn !== undefined) {
      throw new Error(
        `recordEvent: '${input.entityType}' is a platform entity type (D-23), and ` +
          'recordPlatformEvent takes no explicit subjectUrn — a workspace, a membership ' +
          'and an invitation are real subjects with no cross-app address. Drop the ' +
          'parameter rather than working around this check.'
      )
    }
    return recordPlatformEvent(tx, {
      app: APP_SLUG,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      actorTokenId: input.actorTokenId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action as PlatformEventAction,
      diff: input.diff,
      meta: input.meta,
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.occurredAt,
    })
  }

  const subjectUrn =
    input.subjectUrn !== undefined
      ? input.subjectUrn
      : await resolveSubjectUrn(tx, input.workspaceId, input.entityType, input.entityId)

  const values: NewEvent = {
    workspace_id: input.workspaceId,
    app: APP_SLUG,
    subject_urn: subjectUrn,
    actor_user_id: input.actorUserId ?? null,
    actor_token_id: input.actorTokenId ?? null,
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action,
    diff: input.diff ?? null,
    meta: input.meta ?? null,
    idempotency_key: input.idempotencyKey ?? null,
    occurred_at: input.occurredAt ?? new Date(),
  }
  const [row] = await tx.insert(events).values(values).returning()
  if (!row) throw new Error('event insert returned nothing')
  // NO FAN-OUT. See difference (1) in the header — this is an absence with a
  // reason, not a line somebody forgot.
  return row
}
