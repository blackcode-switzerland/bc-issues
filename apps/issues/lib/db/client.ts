import { drizzle as drizzleNeon, NeonDatabase } from 'drizzle-orm/neon-serverless'
import { drizzle as drizzlePg, NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool as NeonPool } from '@neondatabase/serverless'
import { Pool as PgPool } from 'pg'
import * as schema from './schema'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is not set')
}

// The Neon serverless driver speaks Neon's WebSocket proxy protocol, which a
// plain local Postgres (e.g. the Docker container from devops/migrate-local.sh)
// doesn't understand. Local dev URLs point at localhost, so fall back to the
// regular node-postgres driver there; anything else is assumed to be Neon.
const isLocal = /^(localhost|127\.0\.0\.1)$/.test(new URL(url).hostname)

type Database = NeonDatabase<typeof schema> | NodePgDatabase<typeof schema>

declare global {
  var __pgPool: NeonPool | PgPool | undefined
  var __db: Database | undefined
}

const pool =
  global.__pgPool ??
  (isLocal ? new PgPool({ connectionString: url, max: 5 }) : new NeonPool({ connectionString: url, max: 5 }))
if (process.env.NODE_ENV !== 'production') global.__pgPool = pool

export const db: Database =
  global.__db ?? (isLocal ? drizzlePg(pool as PgPool, { schema }) : drizzleNeon(pool as NeonPool, { schema }))
if (process.env.NODE_ENV !== 'production') global.__db = db

export { schema }
