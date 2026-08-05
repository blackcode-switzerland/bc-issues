// Which apps exist, as far as storage is concerned.
//
// Two callers, two different questions, and the difference matters:
//
//   - The reference registry asks for the ENABLED apps, because coverage is
//     about who might still be using a file (references.ts).
//   - The upload handshake asks for ALL apps, because a disabled app's files are
//     still its own and nobody else may write into its prefix.

import { sql } from 'drizzle-orm'
import { apps } from '@blackcode/platform-db/schema'
// Type-only, so there is no runtime cycle with references.ts.
import type { Executor } from './references'

export async function listAppSlugs(
  db: Executor,
  opts: { enabledOnly?: boolean } = {}
): Promise<string[]> {
  const res = opts.enabledOnly
    ? await db.execute(sql`SELECT slug FROM ${apps} WHERE enabled = true`)
    : await db.execute(sql`SELECT slug FROM ${apps}`)
  return res.rows.map((r) => String(r.slug))
}

/** An app, plus the one fact the reference registry needs about it. */
export interface AppCoverage {
  slug: string
  /**
   * Has this app's own migration installed the `platform.blob_references`
   * triggers? Set by that migration, never by application code — see
   * `packages/platform-db/src/schema.ts` at `blobReferences`.
   */
  maintains_blob_index: boolean
}

/**
 * Enabled apps and whether each one can be answered for through the index.
 *
 * This is the input to `assertScannerCoverage`: an enabled app is answerable
 * either because its scanner is registered in THIS process, or because it
 * maintains the index. Neither → the delete gate refuses.
 */
export async function listEnabledAppCoverage(db: Executor): Promise<AppCoverage[]> {
  const res = await db.execute(
    sql`SELECT slug, maintains_blob_index FROM ${apps} WHERE enabled = true ORDER BY slug`
  )
  return res.rows.map((r) => ({
    slug: String(r.slug),
    maintains_blob_index: Boolean(r.maintains_blob_index),
  }))
}
