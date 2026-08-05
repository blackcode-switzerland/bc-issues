// Integration tests for the recycle-bin engine. These hit a real Postgres, so
// they only run when TEST_DATABASE_URL is set (pointed at a throwaway/test DB
// that has had the migrations applied). They never touch the app's DATABASE_URL.
//
//   TEST_DATABASE_URL=postgres://… npm test
//
// Each test seeds a fresh, uniquely-named workspace and tears it down at the
// end (the workspace FK cascade wipes its projects/issues/tasks/batches).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_DB = process.env.TEST_DATABASE_URL
// Point the db client at the test DB before it is imported.
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = TEST_DB ? describe : describe.skip

run('deletion engine (integration)', () => {
  // Imported lazily so the suite can skip cleanly without a DB.
  /* eslint-disable @typescript-eslint/no-var-requires */
  let db: typeof import('../client')['db']
  let schema: typeof import('../schema')
  let engine: typeof import('./deletion')
  let issuesQ: typeof import('./issues')
  let projectsQ: typeof import('./projects')

  let userId: number
  let wsId: number

  beforeAll(async () => {
    db = (await import('../client')).db
    schema = await import('../schema')
    engine = await import('./deletion')
    issuesQ = await import('./issues')
    projectsQ = await import('./projects')

    const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    const [u] = await db
      .insert(schema.users)
      .values({ email: `trash_${suffix}@test.local`, name: 'Trash Tester' })
      .returning({ id: schema.users.id })
    userId = u.id
    const [w] = await db
      .insert(schema.workspaces)
      .values({ name: 'Trash WS', slug: `trash-${suffix}`.slice(0, 40), owner_id: userId })
      .returning({ id: schema.workspaces.id })
    wsId = w.id
    await db.insert(schema.workspaceMembers).values({ workspace_id: wsId, user_id: userId, role: 'owner' })
  })

  afterAll(async () => {
    if (wsId) await db.delete(schema.workspaces).where(eqId(schema.workspaces.id, wsId))
    if (userId) await db.delete(schema.users).where(eqId(schema.users.id, userId))
  })

  function eqId(col: unknown, id: number) {
    // tiny local helper to avoid importing drizzle operators at top level
    const { eq } = require('drizzle-orm')
    return eq(col, id)
  }

  async function makeProjectWithIssues(seqBase: number) {
    const [p] = await db
      .insert(schema.projects)
      .values({ workspace_id: wsId, name: 'P', owner_id: userId })
      .returning({ id: schema.projects.id })
    const [m] = await db
      .insert(schema.tasks)
      .values({ workspace_id: wsId, project_id: p.id, name: 'M' })
      .returning({ id: schema.tasks.id })
    const issueRows = await db
      .insert(schema.issues)
      .values([
        { workspace_id: wsId, seq: seqBase + 1, title: 'I1', project_id: p.id, task_id: m.id },
        { workspace_id: wsId, seq: seqBase + 2, title: 'I2', project_id: p.id },
      ])
      .returning({ id: schema.issues.id })
    return { projectId: p.id, taskId: m.id, issueIds: issueRows.map((r) => r.id) }
  }

  it('cascade delete hides children from active views and excludes them from counts', async () => {
    const { projectId } = await makeProjectWithIssues(1000)

    const before = await projectsQ.listProjectsInWorkspace(wsId)
    expect(before.find((p) => p.id === projectId)?.issue_count).toBe(2)

    await engine.softDeleteProject(wsId, projectId, userId, 'cascade')

    // Project gone from active listing; its issues gone from active issue list.
    const projects = await projectsQ.listProjectsInWorkspace(wsId)
    expect(projects.find((p) => p.id === projectId)).toBeUndefined()
    const issues = await issuesQ.listIssuesInWorkspace(wsId)
    expect(issues.data.length).toBe(0)

    // All three (project + task + 2 issues) sit in the bin under one batch.
    const trash = await engine.listTrash(wsId)
    expect(trash.length).toBe(4)
    const batchIds = new Set(trash.map((t) => t.batch_id))
    expect(batchIds.size).toBe(1)
  })

  it('restoring a batch brings everything back and re-links children', async () => {
    const { projectId, issueIds } = await makeProjectWithIssues(2000)
    await engine.softDeleteProject(wsId, projectId, userId, 'cascade')
    const trash = await engine.listTrash(wsId)
    const batchId = trash[0].batch_id!

    await engine.restoreBatch(wsId, batchId, userId)

    const issues = await issuesQ.listIssuesInWorkspace(wsId)
    const restored = issues.data.filter((i) => issueIds.includes(i.id))
    expect(restored.length).toBe(2)
    // Re-linked to the (also restored) project.
    expect(restored.every((i) => i.project_id === projectId)).toBe(true)
  })

  it('detach delete keeps issues active but unlinked', async () => {
    const { projectId, issueIds } = await makeProjectWithIssues(3000)
    await engine.softDeleteProject(wsId, projectId, userId, 'detach')

    const issues = await issuesQ.listIssuesInWorkspace(wsId)
    const kept = issues.data.filter((i) => issueIds.includes(i.id))
    expect(kept.length).toBe(2)
    expect(kept.every((i) => i.project_id === null)).toBe(true)
  })

  it('restoring an issue standalone clears the binned-parent link', async () => {
    const { projectId, issueIds } = await makeProjectWithIssues(4000)
    await engine.softDeleteProject(wsId, projectId, userId, 'cascade')

    // Restore just one child issue, choosing standalone.
    await engine.restoreItems(wsId, [{ type: 'issue', id: issueIds[0] }], userId, {
      [`issue:${issueIds[0]}`]: 'standalone',
    })

    const issues = await issuesQ.listIssuesInWorkspace(wsId)
    const one = issues.data.find((i) => i.id === issueIds[0])
    expect(one).toBeDefined()
    expect(one!.project_id).toBeNull()
    // The project stays in the bin.
    const trash = await engine.listTrash(wsId, { type: 'project' })
    expect(trash.find((t) => t.id === projectId)).toBeDefined()
  })

  it('purge permanently removes a binned item', async () => {
    const { issueIds } = await makeProjectWithIssues(5000)
    await engine.softDeleteIssue(wsId, issueIds[0], userId)
    const { purged } = await engine.purgeItems(wsId, [{ type: 'issue', id: issueIds[0] }], userId)
    expect(purged).toBe(1)
    const trash = await engine.listTrash(wsId, { type: 'issue' })
    expect(trash.find((t) => t.id === issueIds[0])).toBeUndefined()
  })

  // ---- restore must never claim to have restored something it did not ----
  //
  // Found in PRODUCTION during Phase 6 verification: `restore issue:32` (the
  // #number, not the ref `trash list` prints) answered `restored 1 item(s)` with
  // exit 0 and restored nothing. One Set was doing three jobs — recursion guard,
  // "parent is active so children may link", and the report — and the
  // does-not-exist branch added to all three.
  //
  // These assert the REFUSAL and the COUNT, because "no exception" was exactly
  // what the broken version produced.

  it('REFUSES a ref that does not exist in this workspace', async () => {
    await expect(
      engine.restoreItems(wsId, [{ type: 'issue', id: 999_999_99 }], userId)
    ).rejects.toThrow(/not_in_trash/)
  })

  it('REFUSES a ref belonging to another workspace, and restores nothing', async () => {
    const [otherWs] = await db
      .insert(schema.workspaces)
      .values({ name: `Other ${Date.now()}`, slug: `other-${Date.now()}`, owner_id: userId })
      .returning({ id: schema.workspaces.id })
    try {
      const [foreign] = await db
        .insert(schema.issues)
        .values({ workspace_id: otherWs.id, seq: 7001, title: 'Foreign' })
        .returning({ id: schema.issues.id })
      await engine.softDeleteIssue(otherWs.id, foreign.id, userId)

      // Asking THIS workspace to restore it must fail, and must leave it binned.
      await expect(
        engine.restoreItems(wsId, [{ type: 'issue', id: foreign.id }], userId)
      ).rejects.toThrow(/not_in_trash/)
      const still = await db
        .select({ deleted_at: schema.issues.deleted_at })
        .from(schema.issues)
        .where(eqId(schema.issues.id, foreign.id))
      expect(still[0].deleted_at, 'the other workspace\'s item must stay binned').not.toBeNull()
    } finally {
      await db.delete(schema.workspaces).where(eqId(schema.workspaces.id, otherWs.id))
    }
  })

  it('reports a count of what it ACTUALLY restored, not what it was asked about', async () => {
    const [a] = await db
      .insert(schema.issues)
      .values({ workspace_id: wsId, seq: 7101, title: 'CountA' })
      .returning({ id: schema.issues.id })
    const [b] = await db
      .insert(schema.issues)
      .values({ workspace_id: wsId, seq: 7102, title: 'CountB' })
      .returning({ id: schema.issues.id })
    await engine.softDeleteIssue(wsId, a.id, userId)
    // `b` exists but was never binned — restoring it is a no-op and must be
    // reported as one, or the count means nothing.
    const res = await engine.restoreItems(
      wsId,
      [{ type: 'issue', id: a.id }, { type: 'issue', id: b.id }],
      userId
    )
    expect(res.restored.map((r) => r.id)).toEqual([a.id])
  })

  it('a rejected restore is atomic — a good ref alongside a bad one restores nothing', async () => {
    const [good] = await db
      .insert(schema.issues)
      .values({ workspace_id: wsId, seq: 7201, title: 'Atomic' })
      .returning({ id: schema.issues.id })
    await engine.softDeleteIssue(wsId, good.id, userId)
    await expect(
      engine.restoreItems(
        wsId,
        [{ type: 'issue', id: good.id }, { type: 'issue', id: 999_999_98 }],
        userId
      )
    ).rejects.toThrow(/not_in_trash/)
    const still = await db
      .select({ deleted_at: schema.issues.deleted_at })
      .from(schema.issues)
      .where(eqId(schema.issues.id, good.id))
    expect(still[0].deleted_at, 'the valid item must NOT have been restored').not.toBeNull()
  })

  it('seq is preserved across delete and restore', async () => {
    const [iss] = await db
      .insert(schema.issues)
      .values({ workspace_id: wsId, seq: 6001, title: 'SeqKeep' })
      .returning({ id: schema.issues.id })
    await engine.softDeleteIssue(wsId, iss.id, userId)
    await engine.restoreItems(wsId, [{ type: 'issue', id: iss.id }], userId)
    const got = await issuesQ.getIssue(iss.id)
    expect(got?.seq).toBe(6001)
  })

  // -------------------------------------------------------------------------
  // #number → row id (1.12.0)
  // -------------------------------------------------------------------------
  // `bk trash` used to print row ids. It now prints #numbers, which means a
  // lookup sits in front of restore and purge. The lookup is one query; the
  // consequence of getting it wrong is destroying a row the caller did not name.
  // So these tests are all about the resolution being EXACT and WORKSPACE-SCOPED.
  describe('#number resolution', () => {
    let otherWsId: number
    let mine: { issue: number; project: number; task: number }
    let theirs: { issue: number }

    beforeAll(async () => {
      const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`
      const [w] = await db
        .insert(schema.workspaces)
        .values({ name: 'Other WS', slug: `other-${suffix}`.slice(0, 40), owner_id: userId })
        .returning({ id: schema.workspaces.id })
      otherWsId = w.id

      // The SAME #number 7777 in both workspaces, on purpose.
      const [i1] = await db.insert(schema.issues)
        .values({ workspace_id: wsId, seq: 7777, title: 'mine' })
        .returning({ id: schema.issues.id })
      const [p1] = await db.insert(schema.projects)
        .values({ workspace_id: wsId, seq: 7777, name: 'mine-p', owner_id: userId })
        .returning({ id: schema.projects.id })
      const [t1] = await db.insert(schema.tasks)
        .values({ workspace_id: wsId, seq: 7777, name: 'mine-t' })
        .returning({ id: schema.tasks.id })
      const [i2] = await db.insert(schema.issues)
        .values({ workspace_id: otherWsId, seq: 7777, title: 'theirs' })
        .returning({ id: schema.issues.id })
      mine = { issue: i1.id, project: p1.id, task: t1.id }
      theirs = { issue: i2.id }
    })

    afterAll(async () => {
      if (otherWsId) await db.delete(schema.workspaces).where(eqId(schema.workspaces.id, otherWsId))
    })

    it('resolves a #number to the row with that seq, per type', async () => {
      const refs = await engine.resolveNumberedRefs(wsId, [
        { type: 'issue', number: 7777 },
        { type: 'project', number: 7777 },
        { type: 'task', number: 7777 },
      ])
      expect(refs).toEqual([
        { type: 'issue', id: mine.issue },
        { type: 'project', id: mine.project },
        { type: 'task', id: mine.task },
      ])
    })

    it('NEVER crosses a workspace boundary', async () => {
      // The same #number exists in both workspaces. This is the assertion that
      // stands between a purge and someone else's data.
      const here = await engine.resolveNumberedRefs(wsId, [{ type: 'issue', number: 7777 }])
      const there = await engine.resolveNumberedRefs(otherWsId, [{ type: 'issue', number: 7777 }])
      expect(here[0].id).toBe(mine.issue)
      expect(there[0].id).toBe(theirs.issue)
      expect(here[0].id).not.toBe(there[0].id)
    })

    it('does not confuse a #number with a row id', async () => {
      // The row id of `mine.issue` is some serial; asking for it AS a #number
      // must not find it (unless they coincide, which the guard below excludes).
      if (mine.issue === 7777) return
      await expect(
        engine.resolveNumberedRefs(wsId, [{ type: 'issue', number: mine.issue }])
      ).rejects.toBeInstanceOf(engine.TrashRefNotFoundError)
    })

    it('throws listing EVERY unknown ref, not just the first', async () => {
      // An agent should fix one call, not discover the bad refs one at a time.
      const err = await engine
        .resolveNumberedRefs(wsId, [
          { type: 'issue', number: 999001 },
          { type: 'issue', number: 7777 },
          { type: 'task', number: 999002 },
        ])
        .catch((e) => e)
      expect(err).toBeInstanceOf(engine.TrashRefNotFoundError)
      expect(err.refs).toEqual([
        { type: 'issue', number: 999001 },
        { type: 'task', number: 999002 },
      ])
    })

    it('returns nothing at all when any ref is unknown', async () => {
      // Partial resolution is the dangerous shape: purge would proceed on the
      // subset that happened to resolve.
      await expect(
        engine.resolveNumberedRefs(wsId, [
          { type: 'issue', number: 7777 },
          { type: 'issue', number: 999003 },
        ])
      ).rejects.toBeInstanceOf(engine.TrashRefNotFoundError)
    })

    it('round-trips through numbersForRefs', async () => {
      const map = await engine.numbersForRefs(wsId, [
        { type: 'issue', id: mine.issue },
        { type: 'project', id: mine.project },
      ])
      expect(map.get(`issue:${mine.issue}`)).toBe(7777)
      expect(map.get(`project:${mine.project}`)).toBe(7777)
    })

    it('lists a #number for projects and tasks, not just issues', async () => {
      // These reported NULL before, which is why the REF column could only ever
      // have been a row id.
      await engine.softDeleteEntity(wsId, 'project', mine.project, userId, 'detach')
      const trash = await engine.listTrash(wsId, { type: 'project' })
      expect(trash.find((t) => t.id === mine.project)?.seq).toBe(7777)
    })
  })

  // -------------------------------------------------------------------------
  // A purge says WHAT it destroyed
  // -------------------------------------------------------------------------
  // Purge is the only irreversible action in the product. A bare count is the
  // difference between a wrong purge someone catches immediately and one nobody
  // notices for a month — and the titles only exist up until the row is gone, so
  // if they are not captured inside `purgeOne` they cannot be recovered at all.
  describe('purge echo', () => {
    it('reports the type, #number and title of every item it destroyed', async () => {
      const [i] = await db
        .insert(schema.issues)
        .values({ workspace_id: wsId, seq: 8801, title: 'Delete me, loudly' })
        .returning({ id: schema.issues.id })
      await engine.softDeleteEntity(wsId, 'issue', i.id, userId, 'detach')

      const res = await engine.purgeItems(wsId, [{ type: 'issue', id: i.id }], userId)

      expect(res.purged).toBe(1)
      expect(res.items).toEqual([
        { type: 'issue', id: i.id, number: 8801, title: 'Delete me, loudly' },
      ])
    })

    it('reports nothing for a ref that was not in the bin', async () => {
      // purgeOne refuses a row that is not soft-deleted, and the echo must agree
      // with the count rather than claiming an item that survived.
      const [i] = await db
        .insert(schema.issues)
        .values({ workspace_id: wsId, seq: 8802, title: 'Still alive' })
        .returning({ id: schema.issues.id })

      const res = await engine.purgeItems(wsId, [{ type: 'issue', id: i.id }], userId)

      expect(res.purged).toBe(0)
      expect(res.items).toEqual([])
    })
  })
})
