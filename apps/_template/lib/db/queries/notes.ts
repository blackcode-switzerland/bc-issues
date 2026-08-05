// The query layer: the ONLY place that touches the database.
//
// Routes stay thin — they authenticate, validate, call one of these, and shape
// the JSON. Business logic that lives in a route is logic the CLI, a future UI
// and a background job each have to reimplement.
import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '../client'
import { noteCounters, notes, type Note } from '../schema'

export async function listNotes(workspaceId: number, limit = 50): Promise<Note[]> {
  return getDb()
    .select()
    .from(notes)
    .where(eq(notes.workspace_id, workspaceId))
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
 * A REAL app also projects the row into `platform.entities` here, in this same
 * transaction, so it becomes addressable as `bc:<app>:<ws>/note/<n>` and shows
 * up in `bk search` and `bk link`. That is deliberately left out of the
 * scaffold: it needs the app's URL scheme, and copying it half-configured would
 * produce a projection pointing at pages that do not exist. See
 * `apps/issues/lib/db/queries/entities.ts` and step 10 of
 * `docs/adding-an-app.md`.
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
    return row
  })
}
