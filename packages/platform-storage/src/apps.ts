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
