// Does the DATABASE agree with `QUALIFIED_TYPE_RE`? (D-14, migrations 0041/0042)
//
//   PLATFORM_DB_DRIVER=pg TEST_DATABASE_URL=postgres://… npm test
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// The `<app>:<noun>` rule is written down twice: once as a regex in
// `packages/platform-db/src/qualified-type.ts`, once as a CHECK constraint in
// migrations 0041 and 0042. Two copies of one rule is this codebase's recurring
// silent-drift bug (D-27 trap 2), and here it drifts in a nasty direction —
// loosen the SQL and the shared column starts accepting the bare nouns that
// D-14 exists to keep out, with no test anywhere going red.
//
// So the first test does not probe BEHAVIOUR at all: it reads the constraint
// definition out of `pg_constraint` and compares the regex literal inside it to
// `QUALIFIED_TYPE_RE.source`, character for character. The behavioural tests
// below then check that the constraint is actually attached and enforced, which
// a definition alone cannot show (a constraint can be `NOT VALID`, or dropped).
//
// The inserts run inside a transaction that is rolled back, so this leaves
// nothing behind whatever database it is pointed at.

import { beforeAll, describe, expect, it } from 'vitest'
import { QUALIFIED_TYPE_RE } from '@blackcode/platform-db'
import { LEGACY_BARE, TYPE_CORPUS, shouldBeAccepted } from './qualified-type.test'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = TEST_DB ? describe : describe.skip

/* eslint-disable @typescript-eslint/no-explicit-any */
type Exec = { execute: (q: any) => Promise<{ rows: Record<string, unknown>[] }> }

run('app-qualified type columns agree with QUALIFIED_TYPE_RE (integration)', () => {
  let db: Exec & { transaction: (fn: (tx: any) => Promise<unknown>) => Promise<unknown> }
  let sql: typeof import('drizzle-orm')['sql']

  beforeAll(async () => {
    ;({ db } = (await import('../client')) as never)
    ;({ sql } = await import('drizzle-orm'))
  })

  /** Run `fn` inside a transaction that always rolls back. */
  async function inRolledBackTx(fn: (tx: Exec) => Promise<void>): Promise<void> {
    const marker = new Error('rollback')
    try {
      await db.transaction(async (tx: Exec) => {
        await fn(tx)
        throw marker
      })
    } catch (err) {
      if (err !== marker) throw err
    }
  }

  async function constraintDef(name: string): Promise<string> {
    const r = await db.execute(sql`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}
    ` as never)
    // "Assert your inputs": a constraint that has been DROPPED would otherwise
    // make every comparison below compare two empty strings and pass.
    expect(r.rows.length, `constraint ${name} does not exist`).toBe(1)
    return String(r.rows[0].def)
  }

  for (const name of ['comments_parent_type_check', 'deletion_batches_root_type_check']) {
    it(`${name} embeds exactly QUALIFIED_TYPE_RE`, async () => {
      const def = await constraintDef(name)
      // The pattern as Postgres stored it, between the single quotes of the `~`
      // operand. Anchors included — dropping `^`/`$` is precisely the loosening
      // this test is here to catch.
      const m = def.match(/~ '([^']+)'/)
      expect(m, `no regex operand found in: ${def}`).not.toBeNull()
      expect(m![1]).toBe(QUALIFIED_TYPE_RE.source)
    })

    it(`${name} still accepts exactly the legacy bare values, and no more`, async () => {
      const def = await constraintDef(name)
      // Every bare literal the constraint names must be one of the three that
      // existed before 0041. A fourth would mean somebody re-widened the legacy
      // branch instead of qualifying their noun.
      const literals = [...def.matchAll(/'([a-z_]+)'::character varying/g)].map((x) => x[1])
      expect([...new Set(literals)].sort()).toEqual([...LEGACY_BARE].sort())
    })
  }

  it('accepts and rejects exactly what the TypeScript rule says, on both columns', async () => {
    await inRolledBackTx(async (tx) => {
      const disagreements: string[] = []
      for (const value of TYPE_CORPUS) {
        for (const target of ['comments', 'deletion_batches'] as const) {
          let accepted: boolean
          try {
            await tx.execute(sql`SAVEPOINT probe` as never)
            if (target === 'comments') {
              await tx.execute(sql`
                INSERT INTO platform.comments (workspace_id, parent_type, parent_id, user_id, content)
                VALUES (NULL, ${value}, 1, NULL, 'probe')
              ` as never)
            } else {
              await tx.execute(sql`
                INSERT INTO platform.deletion_batches (workspace_id, mode, root_type, root_id)
                SELECT id, 'cascade', ${value}, 1 FROM platform.workspaces LIMIT 1
              ` as never)
            }
            accepted = true
          } catch {
            accepted = false
          } finally {
            await tx.execute(sql`ROLLBACK TO SAVEPOINT probe` as never)
          }
          const expected = shouldBeAccepted(value)
          if (accepted !== expected) {
            disagreements.push(
              `${target}.${target === 'comments' ? 'parent_type' : 'root_type'} ` +
                `${JSON.stringify(value)} — db:${accepted ? 'accept' : 'reject'} ` +
                `ts:${expected ? 'accept' : 'reject'}`
            )
          }
        }
      }
      expect(disagreements.join('\n')).toBe('')
    })
  })

  // The migration is not "the CHECK was widened" — it is "the CHECK was widened
  // AND every existing row was moved". A backfill that silently matched nothing
  // leaves the bare rows readable (both forms are matched) and therefore leaves
  // no symptom until the contract step deletes them.
  it('0041/0042 left no bare row behind', async () => {
    const r = await db.execute(sql`
      SELECT 'comments' AS t, count(*)::int AS n FROM platform.comments
        WHERE parent_type IN ('issue', 'task', 'project')
      UNION ALL
      SELECT 'deletion_batches', count(*)::int FROM platform.deletion_batches
        WHERE root_type IN ('issue', 'task', 'project')
    ` as never)
    expect(r.rows.map((x) => [x.t, Number(x.n)])).toEqual([
      ['comments', 0],
      ['deletion_batches', 0],
    ])
  })
})
