import { redirect } from 'next/navigation'
import { getDefaultWorkspaceSlug } from '@/lib/default-workspace'

export const dynamic = 'force-dynamic'

export default async function DashboardIndex() {
  const slug = await getDefaultWorkspaceSlug()
  // Zero-workspace onboarding is handled by the parent dashboard layout.
  redirect(slug ? `/dashboard/${slug}` : '/dashboard/workspaces')
}
