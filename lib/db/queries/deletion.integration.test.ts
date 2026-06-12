// Integration tests for the recycle-bin engine. These hit a real Postgres, so
// they only run when TEST_DATABASE_URL is set (pointed at a throwaway/test DB
// that has had the migrations applied). They never touch the app's DATABASE_URL.
//
//   TEST_DATABASE_URL=postgres://… npm test
//
// Each test seeds a fresh, uniquely-named workspace and tears it down at the
// end (the workspace FK cascade wipes its projects/issues/milestones/batches).
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
      .values({ name: 'Trash WS', slug: `trash-${suffix}`.slice(0, 40), key: suffix.slice(-6), owner_id: userId })
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
      .insert(schema.milestones)
      .values({ workspace_id: wsId, project_id: p.id, name: 'M' })
      .returning({ id: schema.milestones.id })
    const issueRows = await db
      .insert(schema.issues)
      .values([
        { workspace_id: wsId, seq: seqBase + 1, title: 'I1', project_id: p.id, milestone_id: m.id },
        { workspace_id: wsId, seq: seqBase + 2, title: 'I2', project_id: p.id },
      ])
      .returning({ id: schema.issues.id })
    return { projectId: p.id, milestoneId: m.id, issueIds: issueRows.map((r) => r.id) }
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

    // All three (project + milestone + 2 issues) sit in the bin under one batch.
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
})
