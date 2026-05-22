import { type NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import CredentialsProvider from 'next-auth/providers/credentials'
import { getUserByEmail, touchLastLogin, upsertUserFromOAuth } from './db/queries/users'
import { verifyPassword } from './auth/password'
import { materializePendingInvitationsForUser } from './db/queries/invitations'

const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET

export const authOptions: NextAuthOptions = {
  providers: [
    ...(googleClientId && googleClientSecret
      ? [
          GoogleProvider({
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          }),
        ]
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

        const user = await getUserByEmail(email)
        if (!user || !user.password_hash) return null

        const ok = await verifyPassword(password, user.password_hash)
        if (!ok) return null

        await touchLastLogin(user.id)
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
        try {
          const result = await upsertUserFromOAuth({
            google_id: account.providerAccountId,
            email: user.email,
            name: user.name,
            avatar_url: user.image,
          })
          if (result.was_new) {
            try {
              await materializePendingInvitationsForUser(result.user.id, result.user.email)
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
        const dbUser = await getUserByEmail(user.email)
        if (dbUser) {
          token.id = dbUser.id
          token.role = dbUser.role
        }
        if (account.provider === 'google' && account.access_token) {
          token.accessToken = account.access_token
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        if (typeof token.id === 'number') session.user.id = token.id
        if (typeof token.role === 'string') session.user.role = token.role
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
}
