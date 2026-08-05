// URNs — the one string that addresses any entity in any app.
//
//   bc:<app>:<workspace-slug>/<entity-type>/<number>
//   bc:issues:kali-sa/issue/482
//
// Three properties, and each one is a decision:
//
//   - The **workspace slug**, not the workspace id. A URN appears in CLI output,
//     in agent prompts and in link tables; a number nobody can read would make
//     every one of those unreadable. It costs a rewrite when a slug changes,
//     which `entities.urn` + ON UPDATE CASCADE absorbs.
//   - The **workspace #number**, never the global row id. This is the same rule
//     every route and every `bk` command already follows, and agents depend on
//     it: `bc:issues:kali-sa/issue/482` is the issue the UI calls #482.
//   - The **app slug**, first. It is what tells a reader — and a router — which
//     app owns this thing without having to look it up.
//
// This file is pure string handling with no database access, so it is safe to
// import anywhere, including in the CLI-facing serialisers.

/** The scheme every Blackcode URN starts with. */
export const URN_SCHEME = 'bc'

export interface ParsedUrn {
  app: string
  workspaceSlug: string
  entityType: string
  number: number
}

// Each segment is deliberately narrow. `app` and `workspaceSlug` match what the
// registry and `slugify()` actually produce; `entityType` also allows `_` because
// an app may well want `project_update`. Anything else is a malformed URN, and
// saying so loudly beats storing a link nobody can resolve.
// `_` is allowed in a slug as well as a type. `slugify()` never produces one, but
// nothing at the database level constrains `workspaces.slug`, and the URN grammar
// only genuinely needs to exclude its own delimiters (`:` and `/`) and anything
// that would not survive a round trip. Rejecting a character the column can hold
// buys nothing and costs a thrown error deep inside a write path — which is
// exactly how a strict formatter here turned a workspace delete into a 500 during
// Phase 6 verification. See `formatUrnOrNull` for the other half of that fix.
const APP_RE = /^[a-z0-9][a-z0-9-]*$/
const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/
const TYPE_RE = /^[a-z0-9][a-z0-9_-]*$/

/** Build a URN. Throws on a component that could not round-trip through parse. */
export function formatUrn(parts: ParsedUrn): string {
  const { app, workspaceSlug, entityType, number } = parts
  if (!APP_RE.test(app)) throw new Error(`invalid app slug in urn: ${JSON.stringify(app)}`)
  if (!SLUG_RE.test(workspaceSlug)) {
    throw new Error(`invalid workspace slug in urn: ${JSON.stringify(workspaceSlug)}`)
  }
  if (!TYPE_RE.test(entityType)) {
    throw new Error(`invalid entity type in urn: ${JSON.stringify(entityType)}`)
  }
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`invalid number in urn: ${JSON.stringify(number)}`)
  }
  return `${URN_SCHEME}:${app}:${workspaceSlug}/${entityType}/${number}`
}

/**
 * `formatUrn`, but null instead of a throw when the components cannot form one.
 *
 * THIS IS THE ONE TO USE ON A WRITE PATH. The projection is an index; it must
 * never be able to take down the thing it indexes. A workspace whose slug somehow
 * cannot appear in a URN should lose its projection — and be reported as
 * `missing` by the reconciler, loudly and repeatably — not make deleting an issue
 * return a 500. That is not hypothetical: the strict version did exactly that,
 * from inside `recordEvent`, before this existed.
 *
 * Keep using `formatUrn` where a throw is the correct answer — building a URN
 * from components you just validated, where failure means a programming error.
 */
export function formatUrnOrNull(parts: ParsedUrn): string | null {
  try {
    return formatUrn(parts)
  } catch {
    return null
  }
}

/**
 * Parse a URN, or return null.
 *
 * Null rather than a throw because every caller is validating untrusted input —
 * a CLI argument or a request body — and wants to turn a bad value into a 400
 * with a `suggestion`, not a 500.
 */
export function parseUrn(raw: string): ParsedUrn | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  // Split on the first two colons only: the remainder is `slug/type/number` and
  // contains no colon, so a greedy split would be wrong the day one does.
  const first = s.indexOf(':')
  if (first < 0) return null
  const second = s.indexOf(':', first + 1)
  if (second < 0) return null
  if (s.slice(0, first) !== URN_SCHEME) return null
  const app = s.slice(first + 1, second)
  const path = s.slice(second + 1)
  const segs = path.split('/')
  if (segs.length !== 3) return null
  const [workspaceSlug, entityType, numRaw] = segs
  if (!APP_RE.test(app)) return null
  if (!SLUG_RE.test(workspaceSlug)) return null
  if (!TYPE_RE.test(entityType)) return null
  if (!/^[0-9]+$/.test(numRaw)) return null
  const number = Number(numRaw)
  if (!Number.isSafeInteger(number) || number < 1) return null
  return { app, workspaceSlug, entityType, number }
}

/** `parseUrn` for callers that have already validated — throws on a bad value. */
export function mustParseUrn(raw: string): ParsedUrn {
  const parsed = parseUrn(raw)
  if (!parsed) throw new Error(`not a Blackcode URN: ${JSON.stringify(raw)}`)
  return parsed
}

/** True if `raw` is a well-formed URN. */
export function isUrn(raw: string): boolean {
  return parseUrn(raw) !== null
}
