import { redirect } from 'next/navigation'

// There is no marketing page and there should not be one: b/sales is internal,
// nobody arrives here without being invited, and `docs/platform-architecture.md`
// puts a landing page in the app that has an audience for it.
//
// So `/` is a redirect to `/dashboard`, which `middleware.ts` gates — an
// unauthenticated visitor lands on `/login` with a `callbackUrl`, and a signed-in
// one lands on their workspace. One place decides who may see what.
export default function Home() {
  redirect('/dashboard')
}
