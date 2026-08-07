import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: '.env.local' })
config({ path: '.env' })

// Generation and migration both run as a HUMAN with the migrator credential, not
// as the app. `sales_app` owns nothing and cannot create a table — see
// docs/platform-db.md for the two credentials. Locally the two are the same
// superuser, which is exactly why the boundary probe has to be run by hand
// against the real role (docs/sql/app-boundary-probe.sql).
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL not set (load .env.local)')

export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dbCredentials: { url },
  strict: true,
  verbose: true,

  // ── A SEPARATE LEDGER, AND IT IS NOT A PREFERENCE ──────────────────────────
  // Every app on this platform shares ONE database (docs/adding-an-app.md step
  // 8: one Neon project, one Blob store, per-app schemas). Drizzle's default
  // ledger is `drizzle.__drizzle_migrations`, and its migrator does this:
  //
  //     select … from <ledger> order by created_at desc limit 1
  //     for (const m of migrations)
  //       if (!last || Number(last.created_at) < m.folderMillis) apply(m)
  //
  // — a single high-water mark over the WHOLE table, with no notion of which app
  // wrote a row. Two apps sharing it means whichever migrated last raises the
  // mark for both, and the other app's next migration is **silently skipped**:
  // no error, no row inserted, and the same comparison skips it again on every
  // subsequent run. The tables simply never appear.
  //
  // Sales' first migration would have hit this immediately — issues' `0043` is
  // stamped later than anything sales could generate — so this is not a
  // hypothetical. One ledger per app, no coordination, no shared watermark.
  //
  // `docs/adding-an-app.md` does not mention it; reported for Phase 13.
  migrations: {
    table: '__drizzle_migrations_sales',
    schema: 'drizzle',
  },
})
