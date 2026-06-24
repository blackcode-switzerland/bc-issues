import { sql, type SQL } from 'drizzle-orm'

/**
 * Build a `?search=` predicate for list endpoints.
 *
 * Matches the free-text query against the given text columns (case-insensitive
 * substring), and — when the query looks like a workspace-facing identifier
 * (e.g. `#123` or `123`) — also against the `seq` column. A leading `#` is
 * stripped before the identifier check. Returns a fragment that begins with
 * `AND (...)`, or an empty fragment when there's nothing to search.
 *
 * Keep this in sync with the client-side matcher in `lib/listing-search.ts`.
 */
export function searchClause(
  search: string | undefined | null,
  cols: { text: SQL[]; seq: SQL }
): SQL {
  const s = (search ?? '').trim()
  if (!s) return sql``
  const like = `%${s}%`
  const conds = cols.text.map((c) => sql`${c} ILIKE ${like}`)
  const id = s.replace(/^#/, '')
  if (/^\d+$/.test(id)) {
    conds.push(sql`CAST(${cols.seq} AS TEXT) ILIKE ${`%${id}%`}`)
  }
  return sql`AND (${sql.join(conds, sql` OR `)})`
}
