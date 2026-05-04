import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: '.env.local' })
config({ path: '.env' })

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
