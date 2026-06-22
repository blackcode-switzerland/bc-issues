import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { getWorkspaceForUser } from '@/lib/db/queries/workspaces'
import { locateEntity } from '@/lib/db/queries/locate'
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
  if (!workspace) {
    // Back-compat: old project detail links were /dashboard/{globalProjectId},
    // which now collides with this [ws] segment. If `ws` is a numeric project id
    // the user can see, forward to its canonical /dashboard/{slug}/projects/{seq}.
    if (/^\d+$/.test(ws)) {
      const loc = await locateEntity('project', parseInt(ws))
      if (loc?.seq != null) {
        const owner = await getWorkspaceForUser(String(loc.workspace_id), user.id)
        if (owner) redirect(`/dashboard/${owner.slug}/projects/${loc.seq}`)
      }
    }
    // Not a member / unknown → fall back to the user's own dashboard.
    redirect('/dashboard')
  }

  return (
    <>
      <PersistActiveWorkspace workspaceId={workspace.id} />
      {children}
    </>
  )
}
