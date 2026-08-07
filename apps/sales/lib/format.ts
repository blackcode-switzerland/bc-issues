// Rendering. Everything here turns a wire value into something a human reads,
// and NONE of it is ever stored or sent.
//
// `lib/views.ts` states the rule from the other side: a relative string is a
// rendering, never storage, and by the same argument never a wire format. So
// `value` arrives as the raw decimal string with `currency` beside it, and
// `CHF 105'000` is made here. That split is why the CLI and the web can disagree
// about presentation without either being wrong.
//
// ── SWISS FORMATTING IS NOT `toLocaleString('de-CH')` ───────────────────────
// It nearly is. `de-CH` groups with U+2019 (a right single quotation mark) in
// modern ICU, which is typographically correct and is what the mockup's
// `CHF 105'000` means. Older ICU used an apostrophe, some used a space. Rather
// than depend on which ICU a Node version or a browser ships, the grouping is
// done here: the separator is one character and one character is not worth an
// environment-dependent answer.

/** The digit grouping mark. U+2019, matching the mockup. */
const GROUP = '’'

/**
 * A money amount as the mockup writes it: `CHF 105’000`.
 *
 * `value` is the decimal string a route serves. Fractional rappen are dropped —
 * every deal value in this product is a round figure, and `CHF 24’000.00` reads
 * as a bill rather than a pipeline number. Null in, em dash out.
 */
export function money(value: string | number | null | undefined, currency = 'CHF'): string {
  if (value == null || value === '') return '—'
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${currency} ${group(Math.round(n))}`
}

/** Just the number, grouped — for a KPI tile that carries its currency in the label. */
export function group(n: number): string {
  const sign = n < 0 ? '-' : ''
  const digits = Math.abs(n).toFixed(0)
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP)
}

/**
 * `Monday 27 July 2026` — the greeting line's date.
 *
 * `en-GB` rather than `en-US`: day-before-month is what Switzerland writes, and
 * the mockup is French. Localisation is not in this phase (the mockup has an
 * FR/EN switch; the real app has one language until somebody asks for two), so
 * this is one explicit locale rather than the browser's, which would make the
 * same screen read differently for two people looking at it together.
 */
export function longDate(d: Date | string): string {
  const date = typeof d === 'string' ? parseDay(d) : d
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** `Wed 29 Jul · 14:30` — a meeting slot. */
export function dateTimeShort(iso: string): string {
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${day} · ${time}`
}

/** `29 Jul 2026` — a date with no time attached to it. */
export function dayLabel(day: string): string {
  return parseDay(day).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * `today`, `yesterday`, `in 3 days`, `6 days ago` — for a due date.
 *
 * Computed against the LOCAL day boundary, deliberately. A due date is a day,
 * not an instant (`lib/views.ts` says so about the wire format too), so
 * "tomorrow" has to mean the reader's tomorrow. Doing this in UTC makes an
 * evening in Zurich show tomorrow's work as due today for four months of the
 * year and not the other eight, which is the kind of bug nobody reproduces.
 */
export function relativeDay(day: string | null | undefined, now = new Date()): string {
  if (!day) return '—'
  const target = parseDay(day)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((target.getTime() - start.getTime()) / 86_400_000)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff === -1) return 'yesterday'
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`
}

/**
 * A `YYYY-MM-DD` string as a LOCAL date at midnight.
 *
 * `new Date('2026-07-27')` parses as UTC midnight, which is the previous evening
 * anywhere west of Greenwich — so a due date would render one day early for part
 * of the world. Splitting the parts and using the local constructor is the fix,
 * and it is why this helper exists rather than a bare `new Date()` at each call.
 */
function parseDay(day: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day)
  if (!m) return new Date(day)
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** `Andrea` from `Andrea Baumann` — the greeting only wants the first name. */
export function firstName(name: string | null | undefined, email?: string | null): string {
  const n = name?.trim()
  if (n) return n.split(/\s+/)[0]
  const local = email?.split('@')[0]
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : 'there'
}
