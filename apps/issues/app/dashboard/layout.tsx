import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { listMyWorkspaces } from '@/lib/db/queries/workspaces'
import { DashboardLayout } from '@/components/dashboard-layout'
import { OnboardingCreateWorkspace } from '@/components/onboarding-create-workspace'

export default async function Layout({
  children,
}: {
  children: React.ReactNode
}) {
  // Validates soft-delete + password-reset session invalidation. A reset signs
  // you out of the dashboard everywhere.
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  // Invariant: a user always works inside a workspace. New accounts get one
  // auto-created at signup; this is the safety net if someone reaches zero
  // (e.g. they deleted their last workspace, or an older account predates the
  // auto-create). Show a full-screen "create your first workspace" instead of
  // a broken dashboard.
  const workspaces = await listMyWorkspaces(user.id)
  if (workspaces.length === 0) {
    const base = user.name?.trim() || user.email.split('@')[0] || 'My'
    return <OnboardingCreateWorkspace defaultName={`${base}'s Workspace`} />
  }

  return <DashboardLayout>{children}</DashboardLayout>
}
