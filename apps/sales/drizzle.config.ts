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
})
