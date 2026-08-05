// The shared Drizzle client factory.
//
// Every app connects to the same Neon project but logs in as its own Postgres
// role (PLATFORM-ARCHITECTURE.md §4.1), so the connection wiring is identical
// everywhere and only the credentials differ. That wiring is what lives here.
//
// The schema is a PARAMETER rather than an import, because each app's schema is
// the platform tables PLUS its own. This is not speculative generalisation — a
// shared client cannot work any other way, since `platform-db` must never know
// what tables `apps/sales` defines.
//
//   apps/issues/lib/db/client.ts:
//     import * as schema from './schema'        // platform + issues tables
//     export const db = createDb(schema)

import { drizzle as drizzleNeon, NeonDatabase } from 'drizzle-orm/neon-serverless'
import { drizzle as drizzlePg, NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool as NeonPool } from '@neondatabase/serverless'
import { Pool as PgPool } from 'pg'

export type PlatformDatabase<TSchema extends Record<string, unknown>> =
  | NeonDatabase<TSchema>
  | NodePgDatabase<TSchema>

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: NeonPool | PgPool | undefined
  // eslint-disable-next-line no-var
  var __db: unknown | undefined
}

/**
 * Build (or reuse) the Drizzle client for `schema`.
 *
 * The instance is cached on `globalThis` outside production so Next's dev-mode
 * module reloading doesn't open a new pool on every edit — the same reason the
 * original single-app client did it.
 *
 * @param schema the app's full Drizzle schema: platform tables plus its own.
 * @param url    connection string; defaults to `DATABASE_URL`.
 */
export function createDb<TSchema extends Record<string, unknown>>(
  schema: TSchema,
  url: string | undefined = process.env.DATABASE_URL
): PlatformDatabase<TSchema> {
  if (!url) {
    throw new Error('DATABASE_URL is not set')
  }

  // The Neon serverless driver speaks Neon's WebSocket proxy protocol, which a
  // plain local Postgres (e.g. the Docker container from devops/migrate-local.sh)
  // doesn't understand. Local dev URLs point at localhost, so fall back to the
  // regular node-postgres driver there; anything else is assumed to be Neon.
  //
  // PLATFORM_DB_DRIVER=pg forces node-postgres regardless of host. That exists
  // for plain Node processes — vitest, a maintenance script — which is where the
  // serverless driver falls over: it needs a global `WebSocket`, and Node only
  // grew one in 22. Neon's pooled endpoint speaks ordinary Postgres over TCP, so
  // `pg` talks to it perfectly well; the serverless driver is for the edge and
  // serverless runtimes, not a requirement of the database. Never set this in the
  // app's own environment — Vercel functions want the serverless driver.
  const forcePg = process.env.PLATFORM_DB_DRIVER === 'pg'
  const isLocal = forcePg || /^(localhost|127\.0\.0\.1)$/.test(new URL(url).hostname)

  const pool =
    global.__pgPool ??
    (isLocal
      ? new PgPool({ connectionString: url, max: 5 })
      : new NeonPool({ connectionString: url, max: 5 }))
  if (process.env.NODE_ENV !== 'production') global.__pgPool = pool

  const db =
    (global.__db as PlatformDatabase<TSchema> | undefined) ??
    (isLocal
      ? drizzlePg(pool as PgPool, { schema })
      : drizzleNeon(pool as NeonPool, { schema }))
  if (process.env.NODE_ENV !== 'production') global.__db = db

  return db
}
