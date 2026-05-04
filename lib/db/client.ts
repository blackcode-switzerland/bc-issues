import { drizzle as drizzlePg, NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is not set')
}

declare global {
  var __pgPool: Pool | undefined
  var __db: NodePgDatabase<typeof schema> | undefined
}

const pool = global.__pgPool ?? new Pool({ connectionString: url, max: 10 })
if (process.env.NODE_ENV !== 'production') global.__pgPool = pool

export const db: NodePgDatabase<typeof schema> = global.__db ?? drizzlePg(pool, { schema })
if (process.env.NODE_ENV !== 'production') global.__db = db

export { schema }
