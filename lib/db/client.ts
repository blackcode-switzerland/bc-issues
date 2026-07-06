import { drizzle as drizzleNeon, NeonDatabase } from 'drizzle-orm/neon-serverless'
import { Pool } from '@neondatabase/serverless'
import * as schema from './schema'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is not set')
}

declare global {
  var __pgPool: Pool | undefined
  var __db: NeonDatabase<typeof schema> | undefined
}

const pool = global.__pgPool ?? new Pool({ connectionString: url, max: 5 })
if (process.env.NODE_ENV !== 'production') global.__pgPool = pool

export const db: NeonDatabase<typeof schema> = global.__db ?? drizzleNeon(pool, { schema })
if (process.env.NODE_ENV !== 'production') global.__db = db

export { schema }
