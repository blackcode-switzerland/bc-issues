// The loopback callback URL `bk login` hands to a browser.
//
// `bk login` starts a local HTTP listener, opens the app's /cli/authorize page,
// and the page POSTs to /api/cli/authorize, which mints a token and redirects
// back to that listener with it in the query string. **The token travels in a
// URL**, so where that URL is allowed to point is the whole of the check:
// loopback host, plain http (a localhost listener has no certificate), and no
// embedded credentials.
//
// Shared because D-21 makes `/api/cli/authorize` Tier 1 for EVERY deployed app —
// `bk login --server https://sales.blackcode.ch` is a legitimate command, and a
// 404 there is exactly the invisible failure D-1 exists to remove. An app
// re-implementing this validation is an app that can get it slightly wrong, and
// getting it wrong means posting a live credential to somewhere else.
//
// Pure, and its own entry point (`@blackcode/platform-auth/cli-callback`): the
// authorize PAGE parses the callback too, in the browser, and must not pull
// bcryptjs and Drizzle into the client bundle.

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
