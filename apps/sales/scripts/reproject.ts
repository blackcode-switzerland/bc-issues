/**
 * Re-derive this app's half of `platform.entities` from this app's own tables.
 *
 *   SALES_REPROJECT=1 npm run db:reproject --workspace=sales
 *   SALES_REPROJECT=1 npm run db:reproject --workspace=sales -- --dry-run
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, AND WHY IT IS A SCRIPT AND NOT `bk super-admin entity-drift`
 * ---------------------------------------------------------------------------
 * **`bk super-admin entity-drift` cannot see a single sales row.** Its help text
 * says it checks "the cross-app entity index against each app's tables", and it
 * does not: the route lives in `apps/issues/app/api/super-admin/entity-drift/`
 * and calls `apps/issues/lib/db/queries/entities.ts`'s `reconcileEntities`,
 * which is bound to `APP_SLUG = 'issues'` and to `issues.*`. Run against a
 * database where every sales row is unprojected, it reports no drift and exits
 * 0 — the most reassuring wrong answer that surface can give.
 *
 * That is not an oversight anybody can fix in one place, either. A single host
 * CANNOT reconcile both apps: `issues_app` has no grant on `sales.*`
 * (`docs/platform-architecture.md` §4.3), so the query cannot be written — not
 * awkwardly, as a database permission. **Each app has to reconcile its own**,
 * from its own deployment, which is D-36's rule about platform routes applied to
 * a job rather than a route. Sales having a reconciler behind `bk` therefore
 * means sales mounting a super-admin surface it does not have today; that is
 * recorded as a Phase 13 item (`docs/sales-app-plan.md`) and deliberately not
 * built here, mid-verification, by the agent whose job is to distrust new code.
 *
 * What is needed NOW is narrower and has no auth surface: the repair itself, for
 * a maintainer with `DATABASE_URL`. Two callers today —
 *
 *   1. after `db:seed`, which deliberately writes no projection (see its header:
 *      seeding one would be a SECOND implementation of the projection);
 *   2. after a change to `lib/dashboard-paths.ts`, because `entityPath`'s output
 *      is STORED in `platform.entities.url` at write time and nothing recomputes
 *      it on read. That is exactly what happened on 2026-08-07.
 *
 * ---------------------------------------------------------------------------
 * IT IMPORTS THE REAL WRITE PATH. THAT IS THE WHOLE DESIGN.
 * ---------------------------------------------------------------------------
 * Every row goes through `projectEntity`, the same function the routes call, so
 * the address scheme is read from `lib/dashboard-paths.ts` and exists once. A
 * SQL `UPDATE … SET url = '/dashboard/' || slug || …` would have been shorter
 * and would have been a second implementation of `entityPath` — which is the
 * defect this script was written to clean up after, reintroduced one layer down.
 *
 * The titles below are the one thing this file states independently, because
 * they live at the call sites rather than in a map. They are copied from the six
 * `projectEntity(` calls in `lib/db/queries/{prospects,ledger,catalog}.ts`, and
 * `--dry-run` reports a title change as `stale`, so a divergence shows up as
 * "every row is stale, every run" rather than as silence.
 */
import { config } from 'dotenv'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { APP_SLUG } from '@/lib/app'
import { ENTITY_TYPES, entityPath, type SalesEntityType } from '@/lib/dashboard-paths'
import { projectEntity } from '@/lib/db/queries/entities'

config({ path: '.env.local' })
config({ path: '.env' })

if (process.env.SALES_REPROJECT !== '1') {
  console.error(
    '✗ refusing to run: SALES_REPROJECT is not set to 1.\n' +
      '  This rewrites platform.entities rows for app=sales in whatever\n' +
      '  DATABASE_URL points at. Run:\n' +
      '    SALES_REPROJECT=1 npm run db:reproject --workspace=sales'
  )
  process.exit(1)
}

const DRY_RUN = process.argv.includes('--dry-run')

/**
 * What each type calls its title, matching the `projectEntity` call sites.
 *
 * `Record<SalesEntityType, …>` on purpose: a seventh entity type is a compile
 * error here rather than a type this script silently skips. A reconciler that
 * quietly ignores a table is worse than no reconciler — it reports "no drift".
 */
const TITLE: Record<SalesEntityType, string> = {
  prospect: 's.name',
  meeting: 's.title',
  communication: "COALESCE(s.subject, s.channel || ' · ' || s.direction)",
  product: 's.name',
  template: 's.name',
  document: 's.title',
}

/** The table each type lives in — `sales.{plural}`, without exception. */
const TABLE: Record<SalesEntityType, string> = {
  prospect: 'prospects',
  meeting: 'meetings',
  communication: 'communications',
  product: 'products',
  template: 'templates',
  document: 'documents',
}

interface SourceRow {
  workspace_id: number
  workspace_slug: string
  entity_type: SalesEntityType
  number: number
  title: string
  deleted_at: Date | null
}

async function sourceRows(db: ReturnType<typeof getDb>): Promise<SourceRow[]> {
  const out: SourceRow[] = []
  for (const type of ENTITY_TYPES) {
    // `sql.raw` for the table and title EXPRESSION only — both come from the two
    // maps above, never from input. Everything else is parameterised.
    const res = await db.execute(
      sql`SELECT s.workspace_id, w.slug AS workspace_slug, s.seq AS number,
                 ${sql.raw(TITLE[type])} AS title, s.deleted_at
          FROM ${sql.raw(`sales.${TABLE[type]}`)} s
          JOIN platform.workspaces w ON w.id = s.workspace_id
          WHERE s.seq IS NOT NULL AND s.workspace_id IS NOT NULL
          ORDER BY s.workspace_id, s.seq`
    )
    for (const r of res.rows) {
      out.push({
        workspace_id: Number(r.workspace_id),
        workspace_slug: String(r.workspace_slug),
        entity_type: type,
        number: Number(r.number),
        title: String(r.title),
        deleted_at: r.deleted_at == null ? null : new Date(String(r.deleted_at)),
      })
    }
  }
  return out
}

async function main() {
  const db = getDb()

  const src = await sourceRows(db)
  // Assert the input. A reconciler that found nothing to reconcile otherwise
  // prints "0 missing, 0 stale" and reads exactly like a clean database.
  if (src.length === 0) {
    console.error(
      '✗ found no sales rows with a seq at all. That is either an empty database\n' +
        '  or a broken query — either way it is not "nothing to do". Refusing to\n' +
        '  report a clean bill of health on no evidence.'
    )
    process.exit(1)
  }

  const projected = await db.execute(sql`
    SELECT entity_type, workspace_id, number, title, url, deleted_at
    FROM platform.entities WHERE app = ${APP_SLUG}`)
  const key = (ws: number, t: string, n: number) => `${ws}:${t}:${n}`
  const have = new Map(
    projected.rows.map((r) => [
      key(Number(r.workspace_id), String(r.entity_type), Number(r.number)),
      r,
    ])
  )

  const baseUrlRes = await db.execute(
    sql`SELECT base_url FROM platform.apps WHERE slug = ${APP_SLUG}`
  )
  const baseUrl = baseUrlRes.rows[0]?.base_url
  console.log(`▶ ${APP_SLUG} base_url is ${baseUrl ?? '(none — urls will be relative)'}`)

  const missing: string[] = []
  const stale: string[] = []
  for (const r of src) {
    const p = have.get(key(r.workspace_id, r.entity_type, r.number))
    const expectedUrl =
      (baseUrl == null ? '' : String(baseUrl).replace(/\/+$/, '')) +
      entityPath(r.workspace_slug, r.entity_type, r.number)
    const label = `${r.entity_type}/${r.number} "${r.title}"`
    if (!p) missing.push(label)
    else {
      const problems: string[] = []
      if (String(p.url) !== expectedUrl) problems.push(`url ${p.url} → ${expectedUrl}`)
      if (String(p.title) !== r.title) problems.push(`title "${p.title}" → "${r.title}"`)
      if ((p.deleted_at == null) !== (r.deleted_at == null)) problems.push('deleted_at')
      if (problems.length) stale.push(`${label}: ${problems.join(', ')}`)
    }
  }

  const orphaned = [...have.keys()].filter(
    (k) => !src.some((r) => key(r.workspace_id, r.entity_type, r.number) === k)
  )

  console.log(`\n  source rows   ${src.length}`)
  console.log(`  projected     ${have.size}`)
  console.log(`  missing       ${missing.length}`)
  console.log(`  stale         ${stale.length}`)
  console.log(`  orphaned      ${orphaned.length}  (not touched — see below)`)
  // STALE IS LISTED IN FULL, missing is truncated. They are not the same news.
  // A missing row is usually a bulk fact — a seed ran, a backfill did not — and
  // forty of them tell you as much as four hundred. A stale row means a value
  // that WAS projected is now wrong, i.e. a write path disagrees with the
  // address map, and the one you truncate is the one nobody fixes. Both of the
  // stale rows here sat past the cutoff of the first version of this report.
  for (const s of stale) console.log(`    stale   ${s}`)
  for (const m of missing.slice(0, 40)) console.log(`    missing ${m}`)
  if (missing.length > 40) console.log(`    missing … and ${missing.length - 40} more`)

  if (orphaned.length > 0) {
    console.log(
      '\n▶ ORPHANED rows are REPORTED AND LEFT. A projection with no source row is\n' +
        '  either a purge that did not clean up or a workspace rename, and the two\n' +
        '  want opposite treatment. Deleting them from a repair script would make\n' +
        '  the destructive case the default:\n' +
        orphaned.map((k) => `    · ${k}`).join('\n')
    )
  }

  if (missing.length === 0 && stale.length === 0) {
    console.log('\n✓ nothing to repair.')
    return
  }
  if (DRY_RUN) {
    console.log('\n▶ --dry-run: nothing written.')
    return
  }

  // One transaction per row, not one for the lot: `projectEntity` is idempotent
  // and a partial repair is a strictly better outcome than an all-or-nothing one
  // that rolls back 300 good rows because of the 301st.
  let repaired = 0
  for (const r of src) {
    await db.transaction(async (tx) => {
      const urn = await projectEntity(tx, {
        workspaceId: r.workspace_id,
        entityType: r.entity_type,
        number: r.number,
        title: r.title,
        deletedAt: r.deleted_at,
      })
      if (urn) repaired++
    })
  }
  console.log(`\n✓ reprojected ${repaired} rows.`)
  if (repaired < src.length) {
    console.log(
      `  ${src.length - repaired} could NOT be projected — projectEntity returned null,\n` +
        '  which means a workspace slug that cannot form a URN. Those rows are\n' +
        '  unaddressable and `bk search` will not return them.'
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('✗ reproject failed:', e)
    process.exit(1)
  })
