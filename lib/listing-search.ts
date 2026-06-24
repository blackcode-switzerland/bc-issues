/**
 * Shared client-side search for the issue / task / project listings.
 *
 * The listings already load their full matching set into the client, so search
 * is best done in-memory: it's instant (no network round-trip per keystroke) and
 * can match across every visible field — the `#seq` identifier, title/name,
 * status, priority, assignees, project/task names, labels, etc.
 *
 * Matching rules (Linear-like):
 *  - The query is split on whitespace into terms; ALL terms must match (AND).
 *  - Each term is a case-insensitive substring match against the item's haystack.
 *  - A leading `#` on a term is stripped, so `#123` and `123` both match the
 *    identifier token (which is stored as `#123` in the haystack).
 */

function norm(value: unknown): string {
  if (value == null || value === false) return ''
  return String(value)
}

/** Strip HTML/markdown-ish tags and entities so rich-text fields stay searchable. */
export function stripTags(value?: string | null): string {
  if (!value) return ''
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[#*_`>~-]/g, ' ')
}

/**
 * Build a single lowercased searchable string from an item's fields. Pass the
 * `seq` first via `idToken()` so identifier search works.
 */
export function buildHaystack(parts: Array<unknown>): string {
  return parts.map(norm).filter(Boolean).join('  ').toLowerCase()
}

/** Identifier tokens for a `seq` — yields both `#123` and `123` forms. */
export function idTokens(seq: number | null | undefined): string[] {
  if (seq == null) return []
  return [`#${seq}`, String(seq)]
}

/** True when every whitespace-separated term in `query` is found in `haystack`. */
export function matchSearch(query: string, haystack: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return q.split(/\s+/).every((term) => {
    const t = term.startsWith('#') ? term.slice(1) : term
    return t === '' || haystack.includes(t)
  })
}
