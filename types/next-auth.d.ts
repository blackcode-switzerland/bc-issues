import 'next-auth'
import { DefaultSession, DefaultUser } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id?: number
      name?: string | null
      email?: string | null
      image?: string | null
      role?: string
    } & DefaultSession['user']
  }

  interface User extends DefaultUser {
    role?: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string | number
    accessToken?: string
  }
}
