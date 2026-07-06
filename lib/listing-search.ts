/**
 * Shared client-side search for the issue / task / project listings.
 *
 * The listings already load their full matching set into the client, so search
 * is best done in-memory: it's instant (no network round-trip per keystroke) and
 * can match across every visible field — the `#seq` identifier, title/name,
 * status, priority, assignees, project/task names, labels, etc.
 *
 * Matching rules (Linear-like), strongest to weakest:
 *  - The query is split on whitespace into terms; ALL terms must match (AND),
 *    though different terms may each match a different field.
 *  - A leading `#` on a term is stripped, so `#123` and `123` both match the
 *    identifier token (`idTokens` emits both forms).
 *  - Per term, per field: exact match > prefix match > word-boundary substring
 *    > mid-word substring > fuzzy (typo-tolerant) match.
 *  - Fields carry a `weight` so, e.g., an identifier or title hit outranks a
 *    match found only in an assignee's email or a description.
 *  - Matches are ranked by total score (best first) rather than only filtered.
 */

export interface SearchField {
  value: unknown
  weight: number
}

/** Wrap a raw field value with a relevance weight (default 1). */
export function field(value: unknown, weight = 1): SearchField {
  return { value, weight }
}

function norm(value: unknown): string {
  if (value == null || value === false) return ''
  return String(value).toLowerCase()
}

/** Strip HTML/markdown-ish tags and entities so rich-text fields stay searchable. */
export function stripTags(value?: string | null): string {
  if (!value) return ''
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[#*_`>~-]/g, ' ')
}

/** Identifier tokens for a `seq` — yields both `#123` and `123` forms. */
export function idTokens(seq: number | null | undefined): string[] {
  if (seq == null) return []
  return [`#${seq}`, String(seq)]
}

/** Bounded Levenshtein distance; returns `max + 1` as soon as it's clear the true distance exceeds `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      rowMin = Math.min(rowMin, cur[j])
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/** Score one search term against one lowercased field value. 0 means no match. */
function termFieldScore(term: string, value: string): number {
  if (!value) return 0
  if (value === term) return 100
  const idx = value.indexOf(term)
  if (idx === 0) return 80
  if (idx > 0) {
    const atWordStart = /[\s/#\-_.]/.test(value[idx - 1])
    return atWordStart ? 60 : 40
  }
  // Typo tolerance: only worth checking for terms long enough that a
  // near-miss is meaningful (avoids "a" fuzzy-matching half the alphabet).
  // Purely numeric terms are excluded too — otherwise a numeric search like
  // "122" would fuzzy-match unrelated identifiers such as "112" or "12".
  if (term.length < 3 || /^\d+$/.test(term)) return 0
  const maxDist = term.length <= 5 ? 1 : 2
  let best = 0
  for (const word of value.split(/\s+/)) {
    if (!word || Math.abs(word.length - term.length) > maxDist) continue
    const d = editDistance(term, word, maxDist)
    if (d <= maxDist) best = Math.max(best, 20 - d * 8)
  }
  return best
}

/**
 * Score `fields` against `query`. Returns -1 if any whitespace-separated term
 * fails to match every field (AND across terms, OR across fields); otherwise
 * the summed best-per-term score, so higher = more relevant. An empty query
 * always scores 0 (matches everything, ties on relevance).
 */
export function searchScore(query: string, fields: SearchField[]): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const terms = q.split(/\s+/).filter(Boolean).map((t) => (t.startsWith('#') ? t.slice(1) : t))
  if (terms.length === 0) return 0
  let total = 0
  for (const term of terms) {
    let best = 0
    for (const f of fields) {
      const value = norm(f.value)
      if (!value) continue
      const s = termFieldScore(term, value) * f.weight
      if (s > best) best = s
    }
    if (best <= 0) return -1
    total += best
  }
  return total
}

/** True when `query` matches `fields` (see `searchScore`). */
export function matchSearch(query: string, fields: SearchField[]): boolean {
  return searchScore(query, fields) >= 0
}

/**
 * Filter `items` to those matching `query` and sort matches best-first. When
 * `query` is blank, `items` is returned unchanged (original order preserved).
 */
export function rankSearch<T>(query: string, items: T[], toFields: (item: T) => SearchField[]): T[] {
  if (!query.trim()) return items
  return items
    .map((item) => ({ item, score: searchScore(query, toFields(item)) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item)
}
