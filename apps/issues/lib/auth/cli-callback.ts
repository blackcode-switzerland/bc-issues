const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export interface ParsedCallback {
  url: URL
}

export function parseCallbackURL(raw: string): ParsedCallback | null {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:') return null
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) return null
  if (parsed.username || parsed.password) return null
  return { url: parsed }
}

export function buildCallbackRedirect(
  raw: string,
  params: Record<string, string>
): string | null {
  const parsed = parseCallbackURL(raw)
  if (!parsed) return null
  const url = parsed.url
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  return url.toString()
}
