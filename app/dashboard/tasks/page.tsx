import { redirect } from 'next/navigation'
import { getDefaultWorkspaceSlug } from '@/lib/default-workspace'

export const dynamic = 'force-dynamic'

export default async function LegacyTasksListing() {
  const slug = await getDefaultWorkspaceSlug()
  redirect(slug ? `/dashboard/${slug}/tasks` : '/dashboard')
}
