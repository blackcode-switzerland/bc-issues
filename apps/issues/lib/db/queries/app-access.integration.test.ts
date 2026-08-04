// Integration tests for per-app access (Phase 4). These hit a real Postgres, so
// they only run when TEST_DATABASE_URL is set (pointed at a throwaway/test DB
// that has had the migrations applied). They never touch the app's DATABASE_URL.
//
//   TEST_DATABASE_URL=postgres://… npm test
//
// ---------------------------------------------------------------------------
// WHY THESE EXIST, AND WHY THEY ASSERT POSITIVE FACTS
// ---------------------------------------------------------------------------
// The orphaned-member query proves the BACKFILL. It cannot prove the CODE: a path
// that creates membership without creating access writes no orphan until someone
// actually uses it. There are exactly two such paths —
//
//   createWorkspace   (also serves POST /api/auth/register and OAuth first login
//                      via lib/auth.ts → ensureDefaultWorkspace)
//   acceptInvitation
//
// — and both are covered below. `addMember` was a third with no callers; Phase 4
// deleted it rather than leave a function that silently creates a lockout.
//
// Every assertion here names the thing that must be TRUE, never merely the
// absence of an error. A missing app_access row does not throw; it renders an
// empty workspace list, which reads as "working correctly, nothing to show". So
// "no exception" is not evidence, and a test that only checked for one would be
// the green suite that proves nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_DB = process.env.TEST_DATABASE_URL
// Point the db client at the test DB before it is imported.
if (TEST_DB) process.env.DATABASE_URL = TEST_DB
// These tests assert enforced behaviour, so make sure the kill switch is off.
process.env.PLATFORM_ENFORCE_APP_ACCESS = '1'

const run = TEST_DB ? describe : describe.skip

run('per-app access (integration)', () => {
  let db: typeof import('../client')['db']
  let schema: typeof import('../schema')
  let workspacesQ: typeof import('./workspaces')
  let invitationsQ: typeof import('./invitations')
  let platformDb: typeof import('@blackcode/platform-db')
  let platformAuth: typeof import('@blackcode/platform-auth')
  let eq: typeof import('drizzle-orm')['eq']

  const APP = 'issues'
  let suffix: string
  let ownerId: number
  let inviteeId: number
  const createdWorkspaceIds: number[] = []

  beforeAll(async () => {
    db = (await import('../client')).db
    schema = await import('../schema')
    workspacesQ = await import('./workspaces')
    invitationsQ = await import('./invitations')
    platformDb = await import('@blackcode/platform-db')
    platformAuth = await import('@blackcode/platform-auth')
    eq = (await import('drizzle-orm')).eq

    suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    const [owner] = await db
      .insert(schema.users)
      .values({ email: `appaccess_owner_${suffix}@test.local`, name: 'Access Owner' })
      .returning({ id: schema.users.id })
    ownerId = owner.id
    const [invitee] = await db
      .insert(schema.users)
      .values({ email: `appaccess_invitee_${suffix}@test.local`, name: 'Access Invitee' })
      .returning({ id: schema.users.id })
    inviteeId = invitee.id

    // The registry row must exist for any of this to mean anything. It is
    // inserted by migration 0034; assert rather than create, because a test that
    // silently seeds it would hide a database that was never migrated.
    const registered = await db.select().from(schema.apps).where(eq(schema.apps.slug, APP))
    expect(
      registered.length,
      `platform.apps has no '${APP}' row — is TEST_DATABASE_URL migrated past 0034?`
    ).toBe(1)
  })

  afterAll(async () => {
    for (const id of createdWorkspaceIds) {
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id))
    }
    if (ownerId) await db.delete(schema.users).where(eq(schema.users.id, ownerId))
    if (inviteeId) await db.delete(schema.users).where(eq(schema.users.id, inviteeId))
  })

  /** Orphaned members of ONE workspace — see the note in the first orphan test. */
  async function orphansIn(workspaceId: number) {
    const all = await platformDb.findOrphanedMembers(db, APP)
    return all.filter((o) => o.workspace_id === workspaceId)
  }

  async function newWorkspace(name: string) {
    const ws = await workspacesQ.createWorkspace({ name, ownerId })
    createdWorkspaceIds.push(ws.id)
    return ws
  }

  // ---- INSERT SITE 1: createWorkspace ----

  it('createWorkspace enables the app and grants its creator access', async () => {
    const ws = await newWorkspace(`Create Path ${suffix}`)

    const wsApp = await platformDb.getWorkspaceApp(db, ws.id, APP)
    expect(wsApp, 'a new workspace must have the app enabled').not.toBeNull()
    expect(wsApp?.default_access).toBe('all_members')

    expect(
      await platformDb.hasAppAccess(db, { app: APP, workspaceId: ws.id, userId: ownerId }),
      'the creator must be able to open the app they just created a workspace in'
    ).toBe(true)

    // The positive fact that matters to a human: THIS user sees THIS workspace,
    // by name, in the app-scoped listing.
    const visible = await workspacesQ.listMyWorkspaces(ownerId, { app: APP })
    expect(visible.map((w) => w.name)).toContain(`Create Path ${suffix}`)
  })

  it('createWorkspace leaves no orphaned member', async () => {
    const ws = await newWorkspace(`Orphan Check ${suffix}`)
    // Scoped to this workspace on purpose. findOrphanedMembers is global, and
    // "member with no grant" is legitimate state elsewhere in this very suite —
    // invite_only workspaces and revoked grants both produce it by design. A
    // global assertion here would be asserting something that is only true in the
    // pre-enforcement window, and it would fail for the right reasons.
    const orphans = await orphansIn(ws.id)
    expect(orphans, 'a membership row with no app_access row is a lockout').toEqual([])
  })

  // ---- the same-transaction guarantee itself ----

  it('a grant made inside a failed transaction does not survive it', async () => {
    // This is the real risk the "same transaction" rule guards against: a helper
    // that reached for `db` instead of the caller's `tx` would commit on its own
    // connection, so membership could roll back while access stayed — or, in the
    // dangerous direction, membership could commit while access rolled back. If
    // this test ever fails, the helpers are not participating in the caller's
    // transaction and both INSERT sites are unsafe regardless of how they look.
    const ws = await newWorkspace(`Tx Guarantee ${suffix}`)
    await db.insert(schema.workspaceMembers).values({
      workspace_id: ws.id,
      user_id: inviteeId,
      role: 'member',
    })
    await platformDb.revokeAppAccess(db, { app: APP, workspaceId: ws.id, userId: inviteeId })

    await expect(
      db.transaction(async (tx) => {
        await platformDb.grantAppAccess(tx, { app: APP, workspaceId: ws.id, userId: inviteeId })
        // Inside the transaction the grant is visible…
        expect(
          await platformDb.hasAppAccess(tx, { app: APP, workspaceId: ws.id, userId: inviteeId })
        ).toBe(true)
        throw new Error('rollback on purpose')
      })
    ).rejects.toThrow('rollback on purpose')

    expect(
      await platformDb.hasAppAccess(db, { app: APP, workspaceId: ws.id, userId: inviteeId }),
      'the grant used the caller transaction, so the rollback must have taken it'
    ).toBe(false)
  })

  // ---- INSERT SITE 2: acceptInvitation ----

  it('accepting an invitation grants access in the same transaction', async () => {
    const ws = await newWorkspace(`Invite Path ${suffix}`)
    const { invitation } = await invitationsQ.createInvitation({
      workspaceId: ws.id,
      email: `appaccess_invitee_${suffix}@test.local`,
      invitedBy: ownerId,
    })

    const result = await invitationsQ.acceptInvitation(
      invitation.token,
      inviteeId,
      `appaccess_invitee_${suffix}@test.local`
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.apps_granted).toContain(APP)

    expect(
      await platformDb.hasAppAccess(db, { app: APP, workspaceId: ws.id, userId: inviteeId }),
      'an invitee who cannot open the app is a member of an empty workspace'
    ).toBe(true)
    expect(await orphansIn(ws.id)).toEqual([])

    const visible = await workspacesQ.listMyWorkspaces(inviteeId, { app: APP })
    expect(visible.map((w) => w.name)).toContain(`Invite Path ${suffix}`)
  })

  it('under invite_only an org-level invite grants nothing, and a per-app invite grants it', async () => {
    const ws = await newWorkspace(`Invite Only ${suffix}`)
    await platformDb.setDefaultAccess(db, ws.id, APP, 'invite_only', ownerId)

    const email = `appaccess_invitee_${suffix}@test.local`
    const org = await invitationsQ.createInvitation({
      workspaceId: ws.id,
      email,
      invitedBy: ownerId,
    })
    const orgResult = await invitationsQ.acceptInvitation(org.invitation.token, inviteeId, email)
    expect(orgResult.ok).toBe(true)
    if (!orgResult.ok) return
    expect(orgResult.apps_granted, 'invite_only must not hand out access').toEqual([])
    expect(
      await platformDb.hasAppAccess(db, { app: APP, workspaceId: ws.id, userId: inviteeId })
    ).toBe(false)

    // …and the denial is the actionable kind, not a dead end.
    let denial: unknown
    try {
      await platformAuth.requireAppAccess(db, {
        app: APP,
        workspaceId: ws.id,
        userId: inviteeId,
        userEmail: email,
        workspaceSlug: ws.slug,
      })
    } catch (e) {
      denial = e
    }
    const err = denial as { status: number; code: string; details: unknown }
    expect(err?.status).toBe(403)
    expect(err?.code).toBe('app_access_denied')
    expect(typeof err?.details, 'the denial must carry a suggestion the CLI can print').toBe(
      'string'
    )
    expect(String(err?.details)).toContain('bk app access grant')

    // Granting it makes the same user see the same workspace.
    await platformDb.grantAppAccess(
      db,
      { app: APP, workspaceId: ws.id, userId: inviteeId },
      { grantedBy: ownerId }
    )
    await expect(
      platformAuth.requireAppAccess(db, { app: APP, workspaceId: ws.id, userId: inviteeId })
    ).resolves.toBeUndefined()
    const visible = await workspacesQ.listMyWorkspaces(inviteeId, { app: APP })
    expect(visible.map((w) => w.name)).toContain(`Invite Only ${suffix}`)
  })

  // ---- the two cascades the schema is supposed to guarantee ----

  it('removing a member removes their access, by cascade', async () => {
    const ws = await newWorkspace(`Cascade Member ${suffix}`)
    await db
      .insert(schema.workspaceMembers)
      .values({ workspace_id: ws.id, user_id: inviteeId, role: 'member' })
    await platformDb.grantAppAccess(db, { app: APP, workspaceId: ws.id, userId: inviteeId })
    expect(
      await platformDb.hasAppAccess(db, { app: APP, workspaceId: ws.id, userId: inviteeId })
    ).toBe(true)

    await workspacesQ.removeMember(ws.id, inviteeId, ownerId)
    expect(
      await platformDb.hasAppAccess(db, { app: APP, workspaceId: ws.id, userId: inviteeId }),
      'access outliving membership would be a grant nobody can see or revoke'
    ).toBe(false)
  })

  it('access without membership is refused by the database, not just by code', async () => {
    const ws = await newWorkspace(`No Membership ${suffix}`)
    // inviteeId is deliberately not a member of this workspace.
    await expect(
      platformDb.grantAppAccess(db, { app: APP, workspaceId: ws.id, userId: inviteeId })
    ).rejects.toThrow()
  })

  // ---- visibility follows access ----

  it('the unscoped listing still shows a workspace the app-scoped one hides', async () => {
    const ws = await newWorkspace(`Hidden But Member ${suffix}`)
    await db
      .insert(schema.workspaceMembers)
      .values({ workspace_id: ws.id, user_id: inviteeId, role: 'member' })
    await platformDb.revokeAppAccess(db, { app: APP, workspaceId: ws.id, userId: inviteeId })

    const scoped = await workspacesQ.listMyWorkspaces(inviteeId, { app: APP })
    expect(scoped.map((w) => w.id)).not.toContain(ws.id)

    // …but `bk workspace list --all` and ensureDefaultWorkspace must still see it.
    // Without this, "where did my workspace go?" has no answer, and a member with
    // no access anywhere would get a SECOND workspace minted for them at login.
    const all = await workspacesQ.listMyWorkspaces(inviteeId)
    expect(all.map((w) => w.id)).toContain(ws.id)
  })

  it('transferring ownership keeps app_access.role in step', async () => {
    const ws = await newWorkspace(`Transfer Roles ${suffix}`)
    await db
      .insert(schema.workspaceMembers)
      .values({ workspace_id: ws.id, user_id: inviteeId, role: 'member' })
    await platformDb.grantAppAccess(db, { app: APP, workspaceId: ws.id, userId: inviteeId })

    await workspacesQ.transferOwnership(ws.id, inviteeId, ownerId)

    const rows = await db
      .select()
      .from(schema.appAccess)
      .where(eq(schema.appAccess.workspace_id, ws.id))
    const byUser = new Map(rows.map((r) => [r.user_id, r.role]))
    expect(byUser.get(inviteeId)).toBe('owner')
    expect(byUser.get(ownerId)).toBe('member')
  })
})
