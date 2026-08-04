import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { listMyWorkspaces } from '@/lib/db/queries/workspaces'
import { APP_SLUG, APP_NAME } from '@/lib/app'
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

  // Two different empties, and telling them apart is the whole point.
  //
  // `reachable` is app-scoped (Phase 4): workspaces where this app is enabled and
  // this user has been granted it. `memberships` is the raw list. If we only
  // looked at the scoped list, a member with no app access would be shown
  // "create your first workspace" — a screen that quietly works (they'd become
  // owner of a brand-new workspace) while hiding the real problem and leaving
  // them with a second workspace nobody asked for.
  const [reachable, memberships] = await Promise.all([
    listMyWorkspaces(user.id, { app: APP_SLUG }),
    listMyWorkspaces(user.id),
  ])

  // Invariant: a user always works inside a workspace. New accounts get one
  // auto-created at signup; this is the safety net if someone reaches zero
  // (e.g. they deleted their last workspace, or an older account predates the
  // auto-create). Show a full-screen "create your first workspace" instead of
  // a broken dashboard.
  if (memberships.length === 0) {
    const base = user.name?.trim() || user.email.split('@')[0] || 'My'
    return <OnboardingCreateWorkspace defaultName={`${base}'s Workspace`} />
  }

  // A member everywhere, granted nowhere. Name the workspaces and who can fix
  // it — an empty dashboard would read as "nothing to show".
  if (reachable.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-lg font-semibold">No access to {APP_NAME}</h1>
          <p className="text-sm text-muted-foreground">
            You are a member of{' '}
            {memberships.map((w) => w.name).join(', ')}, but {APP_NAME} has not been
            enabled for you there.
          </p>
          <p className="text-sm text-muted-foreground">
            A workspace owner can grant it from <strong>Workspace settings → Apps</strong>.
          </p>
          <a href="/api/auth/signout" className="inline-block text-sm underline">
            Sign out
          </a>
        </div>
      </div>
    )
  }

  return <DashboardLayout>{children}</DashboardLayout>
}
