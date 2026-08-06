// Writing a PLATFORM event — the seam between the shared event spine and an
// app's own (docs/sales-app-plan.md D-23, settled 2026-08-06).
//
// ---------------------------------------------------------------------------
// WHY THERE ARE TWO RECORDERS AND NOT ONE
// ---------------------------------------------------------------------------
// `platform.events` is one table, but writing a row to it needs two things that
// only an app has:
//
//   1. a `subject_urn`, derived from the app's own tables, and
//   2. a fan-out rule written in the app's nouns ("everyone watching this
//      issue").
//
// For an event about a workspace, a membership, an app grant or an invitation,
// BOTH of those are empty. `resolveSubjectUrn` returns null for every entity
// type except issue/task/project, in a literal early return before it touches a
// table — so the app-specific half of an app's `recordEvent` contributes nothing
// at all to a platform event. That is what makes this a seam rather than a
// split: there is no app behaviour on this side of it to lose.
//
// So: this function owns the four platform entity types, `recordEvent` in each
// app owns that app's, and an app's recorder delegates the platform ones here
// rather than each app growing its own copy of the same four cases.
//
// ---------------------------------------------------------------------------
// `app` IS THE PRODUCING APP — THE ONE THING TO GET RIGHT
// ---------------------------------------------------------------------------
// `platform.events.app` records WHO WROTE the event, not what the event is
// about. A workspace created from the sales deployment is a `sales` event even
// though a workspace belongs to no app, because "which app did this happen in"
// is the question the activity feed's `?app=` filter is asking.
//
// It is a required parameter for exactly that reason. A default would be a
// default of one app's name inside a package that must not know any app's name,
// and every workspace created from sales would file itself under issues.

import type { PlatformTx } from './client'
import { events, type Event, type NewEvent } from './schema'
import { fanOutPlatformEvent } from './fanout-platform'

// ---------------------------------------------------------------------------
// THE PLATFORM VOCABULARY — ONE COPY, AND IT LIVES BESIDE THE WRITER
// ---------------------------------------------------------------------------
// These two lists are the single source for both halves of the platform event
// spine: what `recordPlatformEvent` may WRITE, and what
// GET /api/workspaces/{ws}/activity accepts as a `?entity_type=` / `?action=`
// FILTER (`packages/platform-api/src/routes/activity.ts` imports them).
//
// They were briefly two hand-maintained copies, and the failure mode of that is
// specific rather than theoretical: `parseList` in the activity route DROPS an
// unrecognised filter instead of rejecting it, so a value this file can write
// and that file has not heard of returns THE WHOLE FEED, silently. That already
// happened once — Phase 4's `app_*` actions were missing from the route's list
// for months.
//
// The runtime lists come first and the types are derived from them, so a value
// added to one cannot be missing from the other.

/**
 * The entity types a platform event can be about.
 *
 * `workspace_app` (Phase 4) is which apps a workspace runs and who may use them.
 * Its `entity_id` is the workspace id and `meta.app` carries the slug, since an
 * app is not a numeric row.
 */
export const PLATFORM_ENTITY_TYPES = [
  'workspace',
  'workspace_member',
  'workspace_app',
  'invitation',
] as const

export type PlatformEntityType = (typeof PLATFORM_ENTITY_TYPES)[number]

const PLATFORM_ENTITY_TYPE_SET: ReadonlySet<string> = new Set(PLATFORM_ENTITY_TYPES)

/** Is this an entity type `recordPlatformEvent` owns? */
export function isPlatformEntityType(t: string): t is PlatformEntityType {
  return PLATFORM_ENTITY_TYPE_SET.has(t)
}

export const PLATFORM_EVENT_ACTIONS = [
  // workspace
  'created',
  'updated',
  'deleted',
  'ownership_transferred',
  // members
  'member_added',
  'member_removed',
  'member_left',
  // apps (Phase 4). None of these fan out to the inbox — see
  // `fanOutPlatformEvent`'s default case — so they are activity-feed only.
  'app_enabled',
  'app_disabled',
  'app_default_access_changed',
  'app_access_granted',
  'app_access_revoked',
  // invitations
  'invitation_created',
  'invitation_revoked',
  'invitation_accepted',
  'invitation_declined',
] as const

export type PlatformEventAction = (typeof PLATFORM_EVENT_ACTIONS)[number]

const PLATFORM_EVENT_ACTION_SET: ReadonlySet<string> = new Set(PLATFORM_EVENT_ACTIONS)

export interface RecordPlatformEventInput {
  /**
   * The app writing this event — `AppContext.appSlug`, never a literal.
   *
   * Required, and validated below. See the header: this is the producing app.
   */
  app: string
  workspaceId: number
  actorUserId?: number | null
  actorTokenId?: number | null
  entityType: PlatformEntityType
  entityId: number
  action: PlatformEventAction
  diff?: { before?: unknown; after?: unknown } | null
  meta?: Record<string, unknown> | null
  idempotencyKey?: string | null
  occurredAt?: Date
}

/**
 * Record one platform event and fan it out, inside the caller's transaction.
 *
 * MUST be called inside the transaction that produces the mutation, like every
 * other write helper in this package. The database has no event triggers, by
 * design — the application layer is the only place an event is invented — so a
 * mutation that commits without its event has lost it permanently.
 *
 * **No coalescing, and no `subjectUrn` parameter.** Both are deliberate:
 *
 *   - Coalescing merges consecutive edits into one activity row and is only safe
 *     for actions that do NOT reach the inbox. Four of the actions here do.
 *   - `subject_urn` is always null. Not "not implemented" — null is the correct
 *     answer. A workspace, a membership and an invitation are real subjects with
 *     no cross-app address; they are not projected into `platform.entities` and
 *     there is no URN to be had. See the header.
 */
export async function recordPlatformEvent(
  tx: PlatformTx,
  input: RecordPlatformEventInput
): Promise<Event> {
  // Cheap, but not decorative. `app` is a FK to platform.apps(slug), so an empty
  // one would fail anyway — as a constraint violation naming a column, from
  // inside a transaction three call frames up. This names the actual mistake.
  if (!input.app) {
    throw new Error(
      'recordPlatformEvent requires `app`: the slug of the app WRITING this event ' +
        '(AppContext.appSlug). platform.events.app is the producing app, and a ' +
        'platform package has no default to fall back to.'
    )
  }

  // The two parameters above are TYPED as platform values, but an app's own
  // recorder has a WIDER union and casts on the way in — so at this boundary the
  // types are a claim, and these are the check. Without them, `{ entityType:
  // 'workspace', action: 'assigned' }` inserts happily and shows up as a
  // workspace that somebody assigned.
  if (!isPlatformEntityType(input.entityType)) {
    throw new Error(
      `recordPlatformEvent: '${input.entityType}' is not a platform entity type. ` +
        `Expected one of: ${PLATFORM_ENTITY_TYPES.join(', ')}. An app's own entity ` +
        "types go through that app's recordEvent, which resolves a subject URN and " +
        'fans out through its own rules.'
    )
  }
  if (!PLATFORM_EVENT_ACTION_SET.has(input.action)) {
    throw new Error(
      `recordPlatformEvent: '${input.action}' is not a platform event action. ` +
        `Expected one of: ${PLATFORM_EVENT_ACTIONS.join(', ')}.`
    )
  }

  const values: NewEvent = {
    workspace_id: input.workspaceId,
    app: input.app,
    subject_urn: null,
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
  await fanOutPlatformEvent(tx, row)
  return row
}
