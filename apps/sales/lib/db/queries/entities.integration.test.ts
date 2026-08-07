// The cross-app entity projection, against a real Postgres.
//
//   TEST_DATABASE_URL=postgres://… npm test --workspace=sales
//
// Skipped without it, and it never touches `DATABASE_URL`.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE HAD TO BE WRITTEN AND NOT REUSED
// ---------------------------------------------------------------------------
// `lib/db/queries/entities.ts` says "`entities.projection.test.ts` asserts the
// rollback case directly". **There was no such file.** The property was checked
// by hand during Phase 3 and the comment recorded the intention as though it
// were a committed check — which is the same shape as CLAUDE.md's table of nine,
// arriving as a citation rather than as a green test. The reference is now true.
//
// ---------------------------------------------------------------------------
// WHY THE INCORRECT CASE IS ALSO ASSERTED
// ---------------------------------------------------------------------------
// "A rolled-back write leaves no projection" passes just as well against a
// `projectEntity` that quietly does nothing at all, or against a database that
// rejected every insert. So this file asserts the SAME sequence written the
// WRONG way — `projectEntity(db, …)` instead of `projectEntity(tx, …)` — and
// requires the projection to SURVIVE.
//
// That is D-26 step 3 made permanent: it is not enough to watch the correct case
// pass, the two ways of writing it have to produce OBSERVABLY DIFFERENT results.
// If the "wrong" case ever stops surviving, this file goes red and tells whoever
// is reading that the correct case has stopped proving anything.
//
// The failure this protects against is the slow kind. A projection written
// outside its transaction commits when the source write rolls back, and nothing
// breaks today: `bk search` returns a title, `bk link` resolves it, and somebody
// clicks through to a 404 weeks later with no way to tell which rows are wrong.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { integrationDescribe } from '@blackcode/platform-testing'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

// `describe.skip` prints one dimmed line and reports green. This says, on
// stderr, that nothing below was checked — and honours REQUIRE_INTEGRATION_TESTS
// for an environment that wants a missing database to be an error instead. The
// ruling and the three options it chose between are in that helper's header.
const run = integrationDescribe({
  describe,
  name: 'sales entity projection + counters + blob triggers',
  databaseUrl: TEST_DB,
  required: process.env.REQUIRE_INTEGRATION_TESTS,
})

run('sales entity projection (integration)', () => {
  let db: ReturnType<typeof import('../client')['getDb']>
  let schema: typeof import('../schema')
  let entitiesQ: typeof import('./entities')
  let countersQ: typeof import('./counters')
  let prospectsQ: typeof import('./prospects')
  let ledgerQ: typeof import('./ledger')
  let eq: typeof import('drizzle-orm')['eq']
  let and: typeof import('drizzle-orm')['and']

  const APP = 'sales'
  let suffix: string
  let ownerId: number
  let wsId: number
  let wsSlug: string

  const actor = () => ({ userId: ownerId, tokenId: null, label: 'Companion' })

  beforeAll(async () => {
    db = (await import('../client')).getDb()
    schema = await import('../schema')
    entitiesQ = await import('./entities')
    countersQ = await import('./counters')
    prospectsQ = await import('./prospects')
    ledgerQ = await import('./ledger')
    const orm = await import('drizzle-orm')
    eq = orm.eq
    and = orm.and

    suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    const [owner] = await db
      .insert(schema.users)
      .values({ email: `sales_proj_${suffix}@test.local`, name: 'Projection Owner' })
      .returning({ id: schema.users.id })
    ownerId = owner!.id

    // Asserted, never created. Seeding the registry row here would hide a
    // database that had never run this app's migrations — and `platform.events`
    // and `platform.entities` both carry an FK to `platform.apps(slug)`, so the
    // failure without it is a constraint violation three call frames away.
    const registered = await db.select().from(schema.apps).where(eq(schema.apps.slug, APP))
    expect(
      registered.length,
      `platform.apps has no '${APP}' row — is TEST_DATABASE_URL migrated and registered?`
    ).toBe(1)

    wsSlug = `sales-proj-${suffix}`.slice(0, 40)
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: `Projection WS ${suffix}`.slice(0, 80), slug: wsSlug, owner_id: ownerId })
      .returning({ id: schema.workspaces.id })
    wsId = ws!.id
  })

  afterAll(async () => {
    if (wsId) await db.delete(schema.workspaces).where(eq(schema.workspaces.id, wsId))
    if (ownerId) await db.delete(schema.users).where(eq(schema.users.id, ownerId))
  })

  const entityByUrn = async (urn: string) =>
    (await db.select().from(schema.entities).where(eq(schema.entities.urn, urn)))[0] ?? null

  /** Rows in the SHARED index for one url — the table another app reads. */
  const blobRefs = async (url: string) => {
    const { sql } = await import('drizzle-orm')
    const res = await db.execute(
      sql`SELECT app, source_type, source_id FROM platform.blob_references WHERE url = ${url}`
    )
    return res.rows
  }

  const projectionCount = async () =>
    (
      await db
        .select()
        .from(schema.entities)
        .where(and(eq(schema.entities.workspace_id, wsId), eq(schema.entities.app, APP)))
    ).length

  // -------------------------------------------------------------------------
  // 1. THE SAME-TRANSACTION PROPERTY, BOTH WAYS ROUND
  // -------------------------------------------------------------------------

  it('a rolled-back write leaves NO projection (projectEntity inside the tx)', async () => {
    const before = await projectionCount()
    let seq = 0

    await expect(
      db.transaction(async (tx) => {
        seq = await countersQ.allocateSeq(tx, wsId, 'prospect')
        await tx
          .insert(schema.prospects)
          .values({ workspace_id: wsId, seq, name: 'Rolled back SA', created_by: ownerId })
        await entitiesQ.projectEntity(tx, {
          workspaceId: wsId,
          entityType: 'prospect',
          number: seq,
          title: 'Rolled back SA',
        })
        // The row must EXIST inside the transaction, or this test passes against
        // a projectEntity that silently did nothing — which is the same green.
        const inside = await tx
          .select()
          .from(schema.entities)
          .where(eq(schema.entities.urn, `bc:sales:${wsSlug}/prospect/${seq}`))
        expect(inside.length, 'projection must exist INSIDE the transaction').toBe(1)
        throw new Error('deliberate rollback')
      })
    ).rejects.toThrow('deliberate rollback')

    expect(await entityByUrn(`bc:sales:${wsSlug}/prospect/${seq}`)).toBeNull()
    expect(await projectionCount()).toBe(before)
  })

  it('THE CONTRAST: projectEntity on `db` SURVIVES the rollback (the bug this shape prevents)', async () => {
    const before = await projectionCount()
    let seq = 0

    await expect(
      db.transaction(async (tx) => {
        seq = await countersQ.allocateSeq(tx, wsId, 'prospect')
        await tx
          .insert(schema.prospects)
          .values({ workspace_id: wsId, seq, name: 'Orphan SA', created_by: ownerId })
        // THE MISTAKE, written deliberately: `db`, not `tx`. It runs on its own
        // connection, outside the caller's transaction, and commits immediately.
        await entitiesQ.projectEntity(db, {
          workspaceId: wsId,
          entityType: 'prospect',
          number: seq,
          title: 'Orphan SA',
        })
        throw new Error('deliberate rollback')
      })
    ).rejects.toThrow('deliberate rollback')

    const orphan = await entityByUrn(`bc:sales:${wsSlug}/prospect/${seq}`)
    expect(
      orphan,
      'the wrong call site produced the SAME result as the right one — which means the ' +
        'test above is no longer proving anything about WHERE projectEntity is called'
    ).not.toBeNull()
    expect(await projectionCount()).toBe(before + 1)

    // And this is exactly what `bk super-admin entity-drift` is for: a row in the
    // projection whose source does not exist.
    const source = await db
      .select()
      .from(schema.prospects)
      .where(and(eq(schema.prospects.workspace_id, wsId), eq(schema.prospects.seq, seq)))
    expect(source.length, 'the source write rolled back, as intended').toBe(0)

    // Cleaned up so the later count assertions are about this file's own writes.
    await db.delete(schema.entities).where(eq(schema.entities.urn, orphan!.urn))
  })

  // -------------------------------------------------------------------------
  // 2. THE REAL WRITE PATHS
  // -------------------------------------------------------------------------

  it('createProspect projects with the #number, and the url ends in it', async () => {
    const p = await prospectsQ.createProspect({
      workspaceId: wsId,
      actor: actor(),
      name: 'Projected SA',
      value: '1200.00',
    })
    const urn = `bc:sales:${wsSlug}/prospect/${p.seq}`
    const row = await entityByUrn(urn)
    expect(row, `no projection for ${urn}`).not.toBeNull()
    expect(row!.title).toBe('Projected SA')
    expect(row!.number).toBe(p.seq)
    expect(row!.deleted_at).toBeNull()
    expect(row!.url).toContain(`/dashboard/${wsSlug}/prospects/${p.seq}`)
    // The rule the whole scheme rests on: the ROW ID must not be addressable.
    expect(row!.url).not.toContain(`/prospects/${p.id}`)
  })

  it('a rename reaches the projection title', async () => {
    const p = await prospectsQ.createProspect({
      workspaceId: wsId,
      actor: actor(),
      name: 'Before Rename SA',
    })
    await prospectsQ.updateProspect(wsId, p.seq, { name: 'After Rename SA' }, actor())
    const row = await entityByUrn(`bc:sales:${wsSlug}/prospect/${p.seq}`)
    // Without this the projection keeps the old name forever and `bk search`
    // answers with a title nobody in the product would recognise.
    expect(row!.title).toBe('After Rename SA')
  })

  it('binning a prospect marks the projection deleted, and does not remove it', async () => {
    const p = await prospectsQ.createProspect({
      workspaceId: wsId,
      actor: actor(),
      name: 'To Be Binned SA',
    })
    await prospectsQ.softDeleteProspect(wsId, p.seq, actor())
    const row = await entityByUrn(`bc:sales:${wsSlug}/prospect/${p.seq}`)
    // The row STAYS. A link into the recycle bin has to survive, because
    // restoring the item has to bring its links back with it.
    expect(row, 'the projection row must survive a soft delete').not.toBeNull()
    expect(row!.deleted_at).not.toBeNull()
  })

  // -------------------------------------------------------------------------
  // 3. THE COUNTER, UNDER CONCURRENCY  (§10.2 row 24)
  // -------------------------------------------------------------------------
  // Committed on 2026-08-07 as part of the Phase 11 ruling on agent4's
  // escalation. It was verified by hand and left out; a property verified once
  // by a person who has moved on is not a property the next change is checked
  // against.
  //
  // The failure it guards is a `seq` COLLISION, and a collision is not a crash:
  // two prospects share a #number, `bc:sales:ws/prospect/7` resolves to whichever
  // the query happens to return, and every link to one of them is a coin flip.
  // The insert has a unique index, so a real collision surfaces here as a
  // rejected insert rather than a duplicate — either way this goes red.

  it('parallel creates allocate distinct #numbers (no counter collision)', async () => {
    const N = 8
    const created = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        prospectsQ.createProspect({ workspaceId: wsId, actor: actor(), name: `Race ${i} SA` })
      )
    )
    const seqs = created.map((p) => p.seq)
    expect(seqs).toHaveLength(N)
    expect(
      new Set(seqs).size,
      `parallel creates produced a duplicate #number: ${seqs.join(', ')}`
    ).toBe(N)
    // Allocated with `UPDATE … RETURNING` inside the insert's transaction, never
    // read-then-write, so the run is contiguous as well as distinct. A gap would
    // mean an allocation escaped its transaction.
    const sorted = [...seqs].sort((a, b) => a - b)
    expect(sorted[N - 1] - sorted[0], `#numbers are not contiguous: ${sorted.join(', ')}`).toBe(N - 1)
  })

  // -------------------------------------------------------------------------
  // 4. THE BLOB-REFERENCE TRIGGERS  (§10.2 row 15)
  // -------------------------------------------------------------------------
  // THE del() PATH. `platform.blob_references` is how another deployment learns
  // that a file is still in use; a reference that is missing is a file another
  // app will delete while this one is still serving it, and Vercel Blob's del()
  // has no undo.
  //
  // It is trigger-maintained precisely so no application write path can forget
  // it — which means the thing to test is NOT a function but the DATABASE. The
  // insert below goes through the real query layer and the assertion reads the
  // shared table; nothing here calls anything that maintains the index, because
  // nothing in the app does.

  it('a communication body carrying an upload URL creates a blob reference', async () => {
    const p = await prospectsQ.createProspect({
      workspaceId: wsId,
      actor: actor(),
      name: 'Blob Trigger SA',
    })
    const url = `/uploads/sales/${wsSlug}/${suffix}-trigger-probe.pdf`
    const c = await ledgerQ.logCommunication({
      workspaceId: wsId,
      prospectId: p.id,
      actor: actor(),
      channel: 'note',
      direction: 'out',
      occurredAt: new Date(),
      body: `the proposal is at ${url}`,
    })
    const refs = await blobRefs(url)
    expect(refs, `no platform.blob_references row for ${url}`).toHaveLength(1)
    expect(refs[0].app).toBe(APP)
    expect(refs[0].source_type).toBe('communication')
    expect(Number(refs[0].source_id)).toBe(c.id)

    // And it UNFIRES. A reference that outlives its row is a file no app will
    // ever delete; a reference that never appears is a file another app WILL.
    await db.delete(schema.communications).where(eq(schema.communications.id, c.id))
    expect(await blobRefs(url), 'the reference outlived the row that held it').toHaveLength(0)
  })

  it('THE CONTRAST: a body with no URL creates NO reference', async () => {
    // Without this, the assertion above passes against a trigger that indexes
    // every row it sees — which would report every communication as holding a
    // file and make every delete refuse. The pair is what proves the trigger
    // reads the body rather than firing on the row.
    const { sql } = await import('drizzle-orm')
    const p = await prospectsQ.createProspect({
      workspaceId: wsId,
      actor: actor(),
      name: 'No Blob SA',
    })
    const c = await ledgerQ.logCommunication({
      workspaceId: wsId,
      prospectId: p.id,
      actor: actor(),
      channel: 'note',
      direction: 'out',
      occurredAt: new Date(),
      body: 'no url in this one at all',
    })
    const res = await db.execute(
      sql`SELECT count(*)::int AS n FROM platform.blob_references
          WHERE app = ${APP} AND source_type = 'communication' AND source_id = ${c.id}`
    )
    expect(Number(res.rows[0].n)).toBe(0)
  })

  it('THE PREMISE: this suite actually wrote projections', async () => {
    // Every "no projection row" assertion above passes against a database where
    // projection never works. Assert the inputs before trusting the conclusions
    // — CLAUDE.md finding #5.
    expect(
      await projectionCount(),
      'no projections at all in this workspace, so the rollback assertions proved nothing'
    ).toBeGreaterThanOrEqual(3)
  })
})
