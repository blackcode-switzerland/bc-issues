/**
 * Re-derive this app's `platform.entities` projection from its source tables.
 *
 *     SCAFFOLD_REPROJECT=1 npm run db:reproject --workspace=scaffold
 *     SCAFFOLD_REPROJECT=1 npm run db:reproject --workspace=scaffold -- --dry-run
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY EVERY APP NEEDS ITS OWN, AND WHY `bk super-admin entity-drift` IS NOT IT
 * ═══════════════════════════════════════════════════════════════════════════
 * The projection is a SECOND WRITE of a fact that already exists, so it can
 * drift from the first one: a write path added later that forgets to call
 * `projectEntity`, a migration that backfills rows directly, a bug someone fixed
 * by hand in psql. Nothing about that drift is visible — `bk search` simply
 * returns fewer rows than there are, which looks like a search that works.
 *
 * `bk super-admin entity-drift` compares the index against the source tables of
 * **the app it is pointed at, and only that one**. It cannot be otherwise: an
 * app's Postgres role has no grant on another app's schema, by design. Its help
 * text claimed it checked "each app's source tables"; run against a database
 * holding 51 unprojected sales rows, it reported no drift and exited 0. That is
 * CLAUDE.md's guardrail finding #14, and it is worse than a dead test because a
 * reconciler is what you reach for when you already suspect something is wrong.
 *
 * So: **one reproject script per app, in the app, run as that app's migrator.**
 * This is the scaffold's, and copying it is copying the operational step that is
 * otherwise remembered only after somebody notices search is short.
 *
 * ── SAFE TO RUN, ALWAYS ────────────────────────────────────────────────────
 * `projectEntity` is an idempotent upsert keyed on
 * (workspace_id, app, entity_type, number), so a full re-run over a correct
 * database changes nothing but `updated_at`. It never deletes: a projection with
 * no source row is REPORTED, not removed, because "the source table is empty" is
 * also what a half-applied migration looks like, and this script must not be the
 * thing that turns that into data loss.
 */
import { config } from 'dotenv'
import { and, eq } from 'drizzle-orm'
import { entities, workspaces } from '@blackcode/platform-db'
import { getDb } from '../lib/db/client'
import { projectEntity, readSourceRows } from '../lib/db/queries/entities'
import { APP_SLUG } from '../lib/app'

config({ path: '.env.local' })
config({ path: '.env' })

// ── TWO GATES, AND THE SECOND ONE IS THE USEFUL ONE ─────────────────────────
// `NODE_ENV` is set by whatever runs the process and is easy to get wrong in a
// shell. `SCAFFOLD_REPROJECT` is a thing nobody has set by accident. This script
// only ever upserts, so it is not destructive — the gate is here because a
// reconciler pointed at the wrong database is a reconciler writing one app's
// URLs over another's, and that IS destructive.
if (process.env.SCAFFOLD_REPROJECT !== '1') {
  process.stderr.write(
    '✗ refusing to run: SCAFFOLD_REPROJECT is not set to 1.\n' +
      '  This writes to platform.entities in whatever database DATABASE_URL names.\n' +
      '  Re-run as:\n' +
      '    SCAFFOLD_REPROJECT=1 npm run db:reproject --workspace=scaffold\n'
  )
  process.exit(1)
}

const dryRun = process.argv.includes('--dry-run')

async function main() {
  const db = getDb()
  const allWorkspaces = await db.select({ id: workspaces.id, slug: workspaces.slug }).from(workspaces)

  // Assert the input. A reconciler that found no workspaces would otherwise
  // print "0 projected, 0 missing" — which reads exactly like a clean database.
  if (allWorkspaces.length === 0) {
    process.stderr.write(
      '✗ no workspaces found. That is not a clean result — it means this is the ' +
        'wrong database, or the platform schema is not migrated. Refusing to ' +
        'report success over an empty read.\n'
    )
    process.exit(1)
  }

  let projected = 0
  let orphaned = 0

  for (const ws of allWorkspaces) {
    const source = await readSourceRows(db, ws.id)
    const existing = await db
      .select({ entity_type: entities.entity_type, number: entities.number })
      .from(entities)
      .where(and(eq(entities.workspace_id, ws.id), eq(entities.app, APP_SLUG)))

    const sourceKeys = new Set(source.map((r) => `${r.entityType}:${r.number}`))
    for (const row of existing) {
      if (!sourceKeys.has(`${row.entity_type}:${row.number}`)) {
        orphaned++
        process.stdout.write(
          `  ORPHAN  ${ws.slug}  ${row.entity_type}/${row.number} — projected, no source row\n`
        )
      }
    }

    for (const row of source) {
      if (dryRun) {
        projected++
        continue
      }
      await db.transaction(async (tx) => {
        await projectEntity(tx, {
          workspaceId: ws.id,
          entityType: row.entityType,
          number: row.number,
          title: row.title,
          deletedAt: row.deletedAt,
        })
      })
      projected++
    }
  }

  process.stdout.write(
    `\n${dryRun ? 'would project' : 'projected'} ${projected} row(s) across ` +
      `${allWorkspaces.length} workspace(s); ${orphaned} orphaned projection(s) reported.\n`
  )
  if (orphaned > 0) {
    process.stdout.write(
      'Orphans are REPORTED, never removed — an empty source table is also what a ' +
        'half-applied migration looks like. Investigate before deleting anything.\n'
    )
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(`✗ reproject failed: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }
)
