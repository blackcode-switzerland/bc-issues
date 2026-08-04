import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { LandingPage } from '@/components/landing-page'

export const dynamic = 'force-dynamic'

/**
 * Public landing page. Signed-out visitors always see it. Signed-in visitors
 * are sent straight into the app — except when they got here by clicking the
 * "blackcode" brand link inside the app sidebar (marked with ?from=app), in
 * which case we let them browse the landing page like anyone else.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>
}) {
  const sp = await searchParams
  if (sp.from !== 'app') {
    const session = await getServerSession(authOptions)
    if (session) redirect('/dashboard')
  }

  return <LandingPage />
}
