// The query layer: the ONLY place that touches the database.
//
// Routes stay thin — they authenticate, validate, call one of these, and shape
// the JSON. Business logic that lives in a route is logic the CLI, a future UI
// and a background job each have to reimplement.
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '../client'
import { noteCounters, notes, type Note } from '../schema'
import { markEntityDeleted, projectEntity } from './entities'

export async function listNotes(workspaceId: number, limit = 50): Promise<Note[]> {
  return getDb()
    .select()
    .from(notes)
    .where(and(eq(notes.workspace_id, workspaceId), isNull(notes.deleted_at)))
    .orderBy(desc(notes.seq))
    .limit(Math.min(Math.max(limit, 1), 200))
}

export async function getNoteByNumber(workspaceId: number, number: number): Promise<Note | null> {
  const [row] = await getDb()
    .select()
    .from(notes)
    .where(and(eq(notes.workspace_id, workspaceId), eq(notes.seq, number)))
    .limit(1)
  return row ?? null
}

/**
 * Create a note, allocating its workspace #number.
 *
 * ONE TRANSACTION, and the counter is bumped with `RETURNING` rather than
 * read-then-write: two concurrent creates otherwise both read the same value and
 * collide on the unique index. This is the single most-copied piece of an app's
 * schema and the easiest to get subtly wrong.
 *
 * ── AND `projectEntity` IS IN THE SAME TRANSACTION. THAT IS THE POINT. ──────
 * It used to be left out of this scaffold with a note saying a real app adds it,
 * which is precisely how it became "the single most forgettable operational step
 * in the app". It is here now, wired, so that copying this file copies the
 * ordering too.
 *
 * Written AFTER the insert and INSIDE the same `tx`. Move it outside and the
 * projection commits even when the source write rolls back, leaving an
 * `entities` row for a note that does not exist — a URN that resolves to a 404
 * that nobody discovers for weeks. `lib/db/queries/entities.ts` has the full
 * argument; this call site is the one that has to be right.
 */
export async function createNote(
  workspaceId: number,
  data: { title: string; body?: string | null; createdBy?: number | null }
): Promise<Note> {
  return getDb().transaction(async (tx) => {
    const counter = await tx.execute(sql`
      INSERT INTO ${noteCounters} (workspace_id, last_note_seq)
      VALUES (${workspaceId}, 1)
      ON CONFLICT (workspace_id)
        DO UPDATE SET last_note_seq = ${noteCounters}.last_note_seq + 1
      RETURNING last_note_seq
    `)
    const seq = Number((counter.rows[0] as { last_note_seq: number }).last_note_seq)

    const [row] = await tx
      .insert(notes)
      .values({
        workspace_id: workspaceId,
        seq,
        title: data.title,
        body: data.body ?? null,
        created_by: data.createdBy ?? null,
      })
      .returning()

    await projectEntity(tx, {
      workspaceId,
      entityType: 'note',
      number: seq,
      title: data.title,
    })

    return row
  })
}

/**
 * Soft delete — into `bk <app> trash`, not gone.
 *
 * The projection is MARKED deleted, not removed: a link pointing at something in
 * the recycle bin still has to resolve, and restoring the note has to bring its
 * links back with it. Only a purge calls `purgeProjectedEntity`.
 */
export async function softDeleteNote(workspaceId: number, number: number): Promise<Note | null> {
  return getDb().transaction(async (tx) => {
    const now = new Date()
    const [row] = await tx
      .update(notes)
      .set({ deleted_at: now, updated_at: now })
      .where(
        and(
          eq(notes.workspace_id, workspaceId),
          eq(notes.seq, number),
          isNull(notes.deleted_at)
        )
      )
      .returning()
    if (!row) return null
    await markEntityDeleted(tx, {
      workspaceId,
      entityType: 'note',
      number,
      deletedAt: now,
    })
    return row
  })
}
