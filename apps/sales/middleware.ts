import { withAuth } from 'next-auth/middleware'
// The SUBPATH, not the barrel. Middleware runs on the Edge runtime, and
// `@blackcode/platform-auth`'s index pulls in `tokens.ts` (node `crypto`) and,
// through `password-reset.ts`, the whole of `platform-db` (`node:crypto`) — none
// of which the Edge runtime can load. `./session-cookie` is deliberately
// dependency-free for this reason; the export map already carried the door.
import { sessionCookieConfig } from '@blackcode/platform-auth/session-cookie'

// The browser gate on the dashboard.
//
// ── `cookies` IS NOT OPTIONAL HERE, AND ITS ABSENCE FAILS SILENTLY ─────────
// `withAuth` verifies the session by calling `getToken`, and `getToken` looks
// for a cookie called `next-auth.session-token` (or `__Secure-…`) **unless it is
// told otherwise**. D-16 renamed this platform's session cookie to
// `blackcode.session-token`, so a middleware that passes nothing here looks for
// a cookie that no deployment sets any more.
//
// The failure is not an error. A signed-in user is redirected to `/login`,
// signs in successfully, is redirected back, and bounces to `/login` again —
// forever, with a 200 on every request and nothing in the logs. Found on
// 2026-08-07 by signing in against the seeded database: NextAuth returned a
// session, `/api/auth/session` served it, and `/dashboard` still bounced.
//
// `sessionCookieConfig()` is the same call `lib/auth.ts` makes, so the name the
// gate looks for and the name the app sets cannot drift apart.
export default withAuth({
  cookies: sessionCookieConfig(),
  pages: {
    signIn: '/login',
  },
})

export const config = {
  matcher: ['/dashboard/:path*'],
}
