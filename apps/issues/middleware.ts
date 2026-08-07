import { withAuth } from 'next-auth/middleware'
// The SUBPATH, not the barrel: middleware runs on the Edge runtime, and
// `@blackcode/platform-auth`'s index pulls in `tokens.ts` (node `crypto`) and,
// through `password-reset.ts`, the whole of `platform-db` (`node:crypto`).
// `./session-cookie` is dependency-free for exactly this reason, and the export
// map already carried the door.
import { sessionCookieConfig } from '@blackcode/platform-auth/session-cookie'

// ── `cookies` IS NOT OPTIONAL, AND OMITTING IT FAILS SILENTLY (D-16) ────────
// `withAuth` verifies the session with `getToken`, and `getToken` falls back to
// **NextAuth's own default cookie name** unless it is given
// `options.cookies.sessionToken.name`. D-16 renamed this platform's session
// cookie, unconditionally — so without this line the app SETS one name and the
// gate LOOKS FOR another.
//
// (Neither name is spelled here on purpose. `lib/auth/session-cookie.test.ts`
// asserts that no source file outside the two whose job is to explain the rename
// contains the old string, so that a stale READER cannot quietly outlive it —
// and middleware is exactly where such a reader would live. That guard caught
// this comment's first draft.)
//
// The failure is not an error anybody sees. Sign-in succeeds, the session is
// real, `/api/auth/session` serves it — and `/dashboard` redirects to `/login`
// forever. 200 on every request, nothing in the logs. **That asymmetry is the
// signature**: a live session endpoint beside a bouncing dashboard means the
// gate and the app disagree about the cookie's name, and nothing else does.
//
// Reproduced against this app on 2026-08-07 before the fix, and the documented
// rollback would not have helped: `AUTH_COOKIE_DOMAIN` only controls the
// `Domain` attribute, while the rename is unconditional (`BASE_NAME`).
//
// Do not "simplify" this back to `withAuth({ pages })`.
export default withAuth({
  cookies: sessionCookieConfig(),
  pages: {
    signIn: '/login',
  },
})

export const config = {
  matcher: ['/dashboard/:path*'],
}
