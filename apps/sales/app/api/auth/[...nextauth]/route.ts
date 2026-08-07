// NextAuth's own handler — browser session machinery, not a product route.
//
// It is excluded from the CLI-parity guard for that reason and the exclusion
// carries the reason in `lib/cli-parity.test.ts`. There is no `bk` command here
// and there must not be: an agent authenticates with a `bk_live_…` token, which
// never touches this path.
import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth'

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }
