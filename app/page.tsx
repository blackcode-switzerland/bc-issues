import { LandingPage } from '@/components/landing-page'

/**
 * Public landing page. Visible to everyone, including authenticated users —
 * they can still click "Sign in" / "Get started" to head into /dashboard.
 */
export default function Home() {
  return <LandingPage />
}
