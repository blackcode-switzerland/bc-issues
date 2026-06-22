import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { getWorkspaceForUser } from '@/lib/db/queries/workspaces'
import { locateEntity } from '@/lib/db/queries/locate'

export const dynamic = 'force-dynamic'

export default async function LegacyIssueRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')
  const loc = await locateEntity('issue', parseInt(id))
  if (loc?.seq != null) {
    const ws = await getWorkspaceForUser(String(loc.workspace_id), user.id)
    if (ws) redirect(`/dashboard/${ws.slug}/issues/${loc.seq}`)
  }
  redirect('/dashboard')
}
