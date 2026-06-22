import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { getWorkspaceForUser } from '@/lib/db/queries/workspaces'
import { PersistActiveWorkspace } from '@/components/persist-active-workspace'

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ ws: string }>
}) {
  const { ws } = await params
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  const workspace = await getWorkspaceForUser(ws, user.id)
  // Not a member / unknown workspace → fall back to the user's own dashboard.
  if (!workspace) redirect('/dashboard')

  return (
    <>
      <PersistActiveWorkspace workspaceId={workspace.id} />
      {children}
    </>
  )
}
