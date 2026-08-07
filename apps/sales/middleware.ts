import { withAuth } from 'next-auth/middleware'

// The browser gate on the dashboard.
//
// ── IT IS INERT TODAY, AND THAT IS DELIBERATE ────────────────────────────────
// Phase 2 ships no `/dashboard` route and no NextAuth config, so this matcher
// matches nothing and this file does nothing. It is here anyway because the
// alternative ordering is worse: adding the dashboard and the middleware in
// separate changes means there is a change in between where the dashboard is
// served to anybody who asks, and nothing in the repo would say so.
//
// Phase 6 adds `lib/auth.ts` (this app's `authOptions` — providers, cookie,
// pages) and `/login`. Until then, `bk` bearer tokens are the only way in, and
// they are checked in `lib/api.ts`, not here.
export default withAuth({
  pages: {
    signIn: '/login',
  },
})

export const config = {
  matcher: ['/dashboard/:path*'],
}
