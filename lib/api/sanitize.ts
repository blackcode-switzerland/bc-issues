// Strip credentials and other sensitive fields out of objects before logging.
// Use this on any value that goes into error_events.context or anywhere
// else we persist arbitrary request data.

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'cookie',
  'set-cookie',
  'secret',
  'api_key',
  'apikey',
  'client_secret',
])

const REDACTED = '[REDACTED]' as const
const MAX_DEPTH = 6
const MAX_STRING = 2_000
const MAX_ARRAY = 50

export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[max-depth]'
  if (value == null) return value
  if (typeof value === 'string') return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + '…' : value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((v) => sanitize(v, depth + 1))
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = REDACTED
      } else {
        out[k] = sanitize(v, depth + 1)
      }
    }
    return out
  }
  return undefined
}

export function truncate(s: string | null | undefined, max: number): string | null {
  if (!s) return null
  return s.length > max ? s.slice(0, max) : s
}
