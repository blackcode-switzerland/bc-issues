import { Suspense } from 'react'
import { LoginForm } from '@/components/login-form'

// Where `middleware.ts` sends an unauthenticated visitor, and where NextAuth
// sends an error. Both are configured in `lib/auth.ts` under `pages`.
//
// `useSearchParams` inside the form needs a Suspense boundary or the whole route
// opts into dynamic rendering — Next says so at build time, and it is the kind
// of warning that gets ignored until a page is slow for a reason nobody can find.
export default function LoginPage() {
  // Read on the SERVER and passed down. `lib/auth.ts` builds its provider list
  // from the same two variables, so the button and the provider appear and
  // disappear together — a "Continue with Google" that 500s because the
  // deployment has no client id is worse than no button.
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  return (
    <Suspense>
      <LoginForm googleEnabled={googleEnabled} />
    </Suspense>
  )
}
