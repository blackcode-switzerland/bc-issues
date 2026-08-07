// Labels — `bk sales label list | view | create | edit | delete | attach | detach`.
//
// ---------------------------------------------------------------------------
// THE TABLE IS PLATFORM'S; THE SCOPE IS THIS APP'S (D-14)
// ---------------------------------------------------------------------------
// A label lives in `platform.labels` and carries an `app` column:
//
//   app = 'sales'   scoped — only this app lists, attaches, renames or deletes it
//   app IS NULL     shared — every app in the workspace sees it
//
// **`app IS NULL OR app = 'sales'` belongs in EVERY read**, not only the list
// route. The schema says so at length and `apps/issues` has a whole test file
// enumerating the paths, because the failure is silent in the worst direction: a
// read that ignores the column returns another app's labels while the command
// spelling (`bk sales label list`) promises otherwise, and an agent then attaches
// an issues label to a prospect.
//
// ---------------------------------------------------------------------------
// AND WHY THIS IS NOT A SHARED FACTORY
// ---------------------------------------------------------------------------
// `attach`/`detach` name an ENTITY, and an entity belongs to one app —
// `internal/appverbs/appverbs.go` makes the same split on the CLI side, keeping
// `bk issues label attach` in the issues package for exactly this reason. The
// CRUD half could be shared one day; the attach half cannot, and splitting one
// noun across two layers to share three functions is not a trade worth making
// while there are two apps.

import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { getDb } from '../client'
import { labels, prospectLabels, prospects } from '../schema'
import type { Label } from '../schema'
import { APP_SLUG } from '@/lib/app'
import { recordEvent } from './events'
import { LABELS_PER_PROSPECT_MAX } from '@/lib/limits'
import type { Actor } from '@/lib/actor'

/**
 * The scope predicate. Written once, imported by every read below.
 *
 * A helper rather than an inlined pair of conditions so that "did this read
 * apply the app scope?" is answerable by grepping for one name.
 */
const visibleToThisApp = () => or(isNull(labels.app), eq(labels.app, APP_SLUG))

export interface LabelRow extends Label {
  /** How many of THIS app's prospects carry it. */
  usage: number
}

export async function listLabels(workspaceId: number): Promise<LabelRow[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(labels)
    .where(and(eq(labels.workspace_id, workspaceId), visibleToThisApp()))
    .orderBy(asc(labels.name))
  if (rows.length === 0) return []

  const counts = await db
    .select({ label_id: prospectLabels.label_id, n: sql<number>`count(*)::int` })
    .from(prospectLabels)
    .innerJoin(prospects, eq(prospects.id, prospectLabels.prospect_id))
    .where(
      and(
        inArray(
          prospectLabels.label_id,
          rows.map((r) => r.id)
        ),
        eq(prospects.workspace_id, workspaceId),
        isNull(prospects.deleted_at)
      )
    )
    .groupBy(prospectLabels.label_id)
  const used = new Map(counts.map((c) => [c.label_id, Number(c.n)]))
  return rows.map((r) => ({ ...r, usage: used.get(r.id) ?? 0 }))
}

export async function getLabel(workspaceId: number, labelId: number): Promise<LabelRow | null> {
  const all = await listLabels(workspaceId)
  return all.find((l) => l.id === labelId) ?? null
}

export async function createLabel(
  workspaceId: number,
  input: { name: string; color?: string | null; description?: string | null },
  actor: Actor
): Promise<Label> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(labels)
      .values({
        workspace_id: workspaceId,
        name: input.name,
        color: input.color ?? undefined,
        description: input.description ?? null,
        // Scoped to this app on creation. Sharing is a DELIBERATE act
        // (`SET app = NULL` on one label), never a state a label drifts into —
        // D-29 settled that and the backfill made it the starting state.
        app: APP_SLUG,
        created_by: actor.userId,
      })
      .returning()
    if (!row) throw new Error('label insert returned nothing')
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'label',
      entityId: row.id,
      action: 'created',
      meta: { name: row.name },
      // A label is not a projected entity; it has no cross-app address.
      subjectUrn: null,
    })
    return row
  })
}

export async function updateLabel(
  workspaceId: number,
  labelId: number,
  input: { name?: string; color?: string | null; description?: string | null },
  actor: Actor
): Promise<Label | null> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const values: Record<string, unknown> = {}
    if (input.name !== undefined) values.name = input.name
    if (input.color !== undefined) values.color = input.color
    if (input.description !== undefined) values.description = input.description
    if (Object.keys(values).length === 0) return null

    const [row] = await tx
      .update(labels)
      .set(values)
      // The scope is in the WHERE, not checked afterwards: an issues label must
      // not be renameable from here, and a guard that reads then writes has a
      // window between the two.
      .where(and(eq(labels.id, labelId), eq(labels.workspace_id, workspaceId), visibleToThisApp()))
      .returning()
    if (!row) return null
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'label',
      entityId: row.id,
      action: 'updated',
      meta: { name: row.name },
      subjectUrn: null,
    })
    return row
  })
}

export async function deleteLabel(
  workspaceId: number,
  labelId: number,
  actor: Actor
): Promise<Label | null> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(labels)
      .where(and(eq(labels.id, labelId), eq(labels.workspace_id, workspaceId), visibleToThisApp()))
      .returning()
    if (!row) return null
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'label',
      entityId: row.id,
      action: 'purged',
      meta: { name: row.name },
      subjectUrn: null,
    })
    return row
  })
}

export type AttachResult =
  | { ok: true; attached: boolean; label: Label }
  | { ok: false; reason: 'label_not_found' }
  | { ok: false; reason: 'too_many'; max: number }

/** Attach a label to a prospect. Idempotent — attaching twice is one state. */
export async function attachLabel(
  workspaceId: number,
  prospectId: number,
  labelId: number,
  actor: Actor
): Promise<AttachResult> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const [label] = await tx
      .select()
      .from(labels)
      .where(and(eq(labels.id, labelId), eq(labels.workspace_id, workspaceId), visibleToThisApp()))
      .limit(1)
    // A 404 rather than a silent no-op: attaching an issues label to a prospect
    // is the exact mistake `labels.app` exists to prevent, and it has to be
    // visible to the caller who tried.
    if (!label) return { ok: false, reason: 'label_not_found' } as const

    const current = await tx
      .select({ label_id: prospectLabels.label_id })
      .from(prospectLabels)
      .where(eq(prospectLabels.prospect_id, prospectId))
    if (current.some((c) => c.label_id === labelId)) {
      return { ok: true, attached: false, label } as const
    }
    if (current.length >= LABELS_PER_PROSPECT_MAX) {
      return { ok: false, reason: 'too_many', max: LABELS_PER_PROSPECT_MAX } as const
    }

    await tx
      .insert(prospectLabels)
      .values({ prospect_id: prospectId, label_id: labelId })
      .onConflictDoNothing()
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'prospect',
      entityId: prospectId,
      action: 'labeled',
      meta: { label: label.name },
    })
    return { ok: true, attached: true, label } as const
  })
}

export async function detachLabel(
  workspaceId: number,
  prospectId: number,
  labelId: number,
  actor: Actor
): Promise<boolean> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const removed = await tx
      .delete(prospectLabels)
      .where(
        and(eq(prospectLabels.prospect_id, prospectId), eq(prospectLabels.label_id, labelId))
      )
      .returning({ label_id: prospectLabels.label_id })
    if (removed.length === 0) return false
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'prospect',
      entityId: prospectId,
      action: 'unlabeled',
      meta: { label_id: labelId },
    })
    return true
  })
}
