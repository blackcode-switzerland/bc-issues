// One sign-in across every app on the platform (D-16).
//
// ---------------------------------------------------------------------------
// WHY THIS IS SHARED CODE AND NOT EACH APP'S BUSINESS
// ---------------------------------------------------------------------------
// It is ONE credential. Two apps that disagree about the cookie's name, domain
// or flags do not produce two sessions — they produce one that works in one
// place and silently does not in the other, and the weakest configuration sets
// the real behaviour for everybody (D-27 item 3). Every app spreads the SAME
// object into its `authOptions.cookies`, and the only per-deployment input is an
// environment variable.
//
// ---------------------------------------------------------------------------
// IT IS A RENAME, NOT A WIDENING, AND THE REASON IS NOT THE ONE YOU EXPECT
// ---------------------------------------------------------------------------
// The plan (D-16) says the rename is forced by the `__Host-` prefix, which
// cannot carry a `Domain`. **That is not what NextAuth names the session
// cookie.** Checked against the installed next-auth 4.24.13,
// `core/lib/cookie.js`:
//
//     sessionToken   __Secure-next-auth.session-token    ← Domain is ALLOWED
//     csrfToken      __Host-next-auth.csrf-token         ← Domain is forbidden
//
// `__Host-` is on the CSRF cookie, which is per-host and must STAY per-host —
// widening it would be a security regression, and this module deliberately does
// not touch it. So on the prefix alone, the session cookie could simply have
// gained a domain.
//
// It is still a rename, for a different and better reason: **a cookie's identity
// in the browser jar is (name, domain, path)**. Re-issuing the same name with
// `Domain=.blackcode.ch` does not replace the existing host-only cookie — it
// creates a SECOND one. Both are then sent on every request to the original
// host, in an order the spec does not pin down, and Next.js's parser keeps the
// first. The app would keep refreshing one cookie while reading the other, sign-
// out would clear one of the two, and the symptom would be an intermittent
// stale session with no way to reason about it from the outside.
//
// A new name makes the old cookie inert — nothing reads it — and the new one
// unambiguous. **The old cookie is not deleted**: it sits in browsers until it
// expires (NextAuth's default is 30 days), harmless because no code looks for
// it. That is the trade being made deliberately.
//
// EVERYONE IS SIGNED OUT ONCE. That is the whole cost, it is expected, and the
// changelog entry announcing it must be published BEFORE the deploy.
//
// ---------------------------------------------------------------------------
// THE FAILURE MODE THIS MODULE IS SHAPED AROUND
// ---------------------------------------------------------------------------
// A `Domain` the browser rejects is not an error anybody sees. The Set-Cookie is
// dropped, the session never establishes, and every sign-in appears to succeed
// and then bounce straight back to the login page — on every browser, for every
// user, with a green deploy and nothing in the logs.
//
// So the domain is NEVER hardcoded and NEVER guessed:
//
//   - unset  → no `Domain` attribute at all, i.e. host-only, exactly the
//              behaviour that exists today. This is what keeps `localhost` and
//              every `*.vercel.app` preview working, and it is the default
//              precisely because those are the environments where a
//              `.blackcode.ch` domain would be silently rejected.
//   - set    → validated against `NEXTAUTH_URL` at construction, and a mismatch
//              THROWS. A boot failure is loud, immediate and obviously about
//              this; a rejected cookie is none of those things.

/** What NextAuth expects under `authOptions.cookies`. Structural, so this package needs no next-auth dependency. */
export interface SessionCookieConfig {
  sessionToken: {
    name: string
    options: {
      httpOnly: true
      sameSite: 'lax'
      path: '/'
      secure: boolean
      domain?: string
    }
  }
}

export interface SessionCookieInput {
  /** `NEXTAUTH_URL`. Decides the `__Secure-` prefix and the `secure` flag, exactly as NextAuth does. */
  nextAuthUrl?: string
  /** `AUTH_COOKIE_DOMAIN`, e.g. `.blackcode.ch`. Empty/absent means host-only. */
  cookieDomain?: string
}

/**
 * The cookie name, minus the prefix. Deliberately NOT `next-auth.…`: the point
 * of the rename is that a browser holding the old cookie is holding something no
 * deployment reads.
 */
const BASE_NAME = 'blackcode.session-token'

export class SessionCookieDomainError extends Error {
  constructor(domain: string, host: string) {
    super(
      `AUTH_COOKIE_DOMAIN=${JSON.stringify(domain)} cannot be set by a server on ` +
        `${JSON.stringify(host)} — the browser would reject the cookie and every ` +
        `sign-in would bounce back to the login page with nothing in the logs. ` +
        `The domain must equal the host or be a parent of it (e.g. ".blackcode.ch" ` +
        `for "issues.blackcode.ch"). Unset it for localhost and preview deployments.`
    )
    this.name = 'SessionCookieDomainError'
  }
}

/** Host of a URL, or '' when it is absent or unparseable. */
function hostOf(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/**
 * `true` when `host` is `domain` or a subdomain of it. A leading dot on the
 * domain is optional — browsers ignore it — so both spellings are accepted.
 */
export function domainCoversHost(domain: string, host: string): boolean {
  const d = domain.replace(/^\./, '').toLowerCase()
  const h = host.toLowerCase()
  if (!d || !h) return false
  return h === d || h.endsWith('.' + d)
}

/**
 * The shared session-cookie configuration. Every app spreads the result into
 * `authOptions.cookies`.
 *
 * Throws `SessionCookieDomainError` when the configured domain could not be set
 * by this deployment. See the header: that is the one failure worth crashing on,
 * because the alternative is invisible.
 */
export function sessionCookieConfig(input: SessionCookieInput = {}): SessionCookieConfig {
  const nextAuthUrl = input.nextAuthUrl ?? process.env.NEXTAUTH_URL
  const rawDomain = (input.cookieDomain ?? process.env.AUTH_COOKIE_DOMAIN ?? '').trim()

  // Same rule NextAuth applies, so the prefix and the `secure` flag agree with
  // the cookies this config does NOT override (csrf, callbackUrl, pkce, state).
  // Disagreeing would give one deployment a `__Secure-` session cookie beside a
  // non-secure CSRF cookie, which is a confusing half-state to debug.
  const secure = (nextAuthUrl ?? '').startsWith('https://')

  let domain: string | undefined
  if (rawDomain) {
    const host = hostOf(nextAuthUrl)
    // Only validate when there is something to validate against. A build step
    // with no NEXTAUTH_URL must not fail; the runtime has one.
    if (host && !domainCoversHost(rawDomain, host)) {
      throw new SessionCookieDomainError(rawDomain, host)
    }
    domain = rawDomain
  }

  return {
    sessionToken: {
      name: `${secure ? '__Secure-' : ''}${BASE_NAME}`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure,
        ...(domain ? { domain } : {}),
      },
    },
  }
}

/**
 * The name this configuration produces, for anything that needs to talk about
 * the cookie without constructing the whole config — a doc string, a test, a
 * migration note. Never used to READ the cookie: NextAuth does that.
 */
export function sessionCookieName(secure: boolean): string {
  return `${secure ? '__Secure-' : ''}${BASE_NAME}`
}
