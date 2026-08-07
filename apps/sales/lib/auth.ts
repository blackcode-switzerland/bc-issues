// This app's NextAuth configuration.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE IS THIS APP'S AND NOT THE PLATFORM'S
// ---------------------------------------------------------------------------
// `packages/platform-auth/src/index.ts` carries the full argument and it is not
// re-litigated here. The short version: what these callbacks DO to the database
// is shared and lives in `platform-db`'s `sign-in.ts`; what stays is the bundle
// of things that are genuinely one deployment's — which providers it offers,
// whose client credentials they use, and which URLs an unauthenticated visitor
// is sent to.
//
// The session COOKIE is not one of those. It is one credential across every
// deployment (D-16), so it is spread in from `@blackcode/platform-auth` and
// nothing about it is configured here.
//
// ---------------------------------------------------------------------------
// THE ONE PLACE THIS DIFFERS FROM `apps/issues`, AND IT IS DELIBERATE
// ---------------------------------------------------------------------------
// **A first sign-in here does NOT create a workspace.** Issues calls
// `ensureDefaultWorkspace` on a new Google account; sales does not, and D-3 is
// why: sales renders no workspace switcher and no create-workspace flow, so a
// workspace minted at sign-in would be one the human can neither see nor leave —
// and it would arrive with `sales` not enabled on it, which is the "onboarding
// screen that quietly works while hiding the real problem" that
// `app/dashboard/layout.tsx` exists to prevent.
//
// A person who belongs to nothing gets told so, by name, with who can fix it.
// That is the honest answer for an internal pipeline nobody self-serves into.
//
// Pending invitations ARE still materialised: those were addressed to this
// person by somebody who already decided they belong.
import { type NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import CredentialsProvider from 'next-auth/providers/credentials'
import {
  getUserByEmail,
  materializePendingInvitationsForUser,
  touchLastLogin,
  upsertUserFromOAuth,
} from '@blackcode/platform-db'
import {
  isEmailAllowed,
  isSuperAdmin,
  sessionCookieConfig,
  verifyPassword,
} from '@blackcode/platform-auth'
import { getDb } from './db/client'

const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET

export const authOptions: NextAuthOptions = {
  providers: [
    ...(googleClientId && googleClientSecret
      ? [GoogleProvider({ clientId: googleClientId, clientSecret: googleClientSecret })]
      : []),
    CredentialsProvider({
      id: 'credentials',
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase()
        const password = credentials?.password ?? ''
        if (!email || !password) return null

        const user = await getUserByEmail(getDb(), email)
        if (!user || !user.password_hash) return null

        const ok = await verifyPassword(password, user.password_hash)
        if (!ok) return null

        await touchLastLogin(getDb(), user.id)
        return {
          id: String(user.id),
          email: user.email,
          name: user.name ?? undefined,
          image: user.avatar_url ?? undefined,
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'google') {
        if (!user.email) return false
        // Who may exist on the platform at all. Off when SUPER_ADMINS is unset,
        // which is what keeps local development working.
        const allowed = await isEmailAllowed(getDb(), user.email)
        if (!allowed) return '/blocked'
        try {
          const result = await upsertUserFromOAuth(getDb(), {
            google_id: account.providerAccountId,
            email: user.email,
            name: user.name,
            avatar_url: user.image,
          })
          if (result.was_new) {
            // No `ensureDefaultWorkspace` — see the header.
            try {
              await materializePendingInvitationsForUser(
                getDb(),
                result.user.id,
                result.user.email
              )
            } catch (mErr) {
              console.error('materialize pending invitations failed:', mErr)
            }
          }
        } catch (error) {
          console.error('Failed to upsert user:', error)
        }
      }
      return true
    },
    async jwt({ token, user, account }) {
      if (account && user?.email) {
        const dbUser = await getUserByEmail(getDb(), user.email)
        if (dbUser) {
          token.id = dbUser.id
          token.pwStamp = dbUser.password_changed_at ? dbUser.password_changed_at.getTime() : 0
        }
        token.isSuperAdmin = isSuperAdmin(user.email)
        if (account.provider === 'google' && account.access_token) {
          token.accessToken = account.access_token
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        if (typeof token.id === 'number') session.user.id = token.id
        if (typeof token.pwStamp === 'number') session.user.pwStamp = token.pwStamp
        if (typeof token.isSuperAdmin === 'boolean') session.user.isSuperAdmin = token.isSuperAdmin
      }
      return session
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: {
    strategy: 'jwt',
  },
  // ONE SIGN-IN ACROSS EVERY APP (D-16). Shared, never configured here: two apps
  // disagreeing about this cookie's name or domain produce a session that works
  // in one place and silently does not in the other. The whole decision — why it
  // is a rename rather than a widening, and what a wrong domain looks like — is
  // in `packages/platform-auth/src/session-cookie.ts`.
  //
  // Set `AUTH_COOKIE_DOMAIN=.blackcode.ch` in production and leave it UNSET
  // everywhere else.
  cookies: sessionCookieConfig(),
}
