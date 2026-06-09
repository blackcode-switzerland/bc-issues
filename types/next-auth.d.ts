import 'next-auth'
import { DefaultSession, DefaultUser } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id?: number
      name?: string | null
      email?: string | null
      image?: string | null
      // Snapshot of users.password_changed_at at sign-in time. Used to
      // invalidate sessions when the password is reset.
      pwStamp?: number
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
    pwStamp?: number
  }
}
