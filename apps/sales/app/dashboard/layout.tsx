import { redirect } from 'next/navigation'
import { listMyWorkspaces } from '@blackcode/platform-db'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { APP_SLUG } from '@/lib/app'

/**
 * ── TWO DIFFERENT EMPTIES, AND TELLING THEM APART IS THE WHOLE POINT ────────
 *
 * `reachable` is app-scoped: workspaces where `sales` is enabled AND this user
 * has been granted it. `memberships` is the raw list. They answer different
 * questions and collapsing them produces the failure `apps/issues` documented:
 * a member who simply has not been granted the app sees an onboarding screen
 * that quietly *works*, which hides the real problem and leaves them worse off
 * than an error would have.
 *
 * ── WHERE SALES DIFFERS FROM ISSUES, AND WHY IT IS NOT A REGRESSION ────────
 * Issues answers the first empty with "create your first workspace". Sales
 * cannot and must not: D-3 removes the create-workspace flow from this app
 * entirely. So the first empty is a statement of fact plus who fixes it, rather
 * than a form. It is the honest answer for a product people arrive in by
 * invitation — and the two empties still say genuinely different things, which
 * is the property being preserved.
 *
 * ── THE ENFORCEMENT SWITCH IS PART OF THIS ─────────────────────────────────
 * `listMyWorkspaces({ app })` filters only when `PLATFORM_ENFORCE_APP_ACCESS` is
 * on. With it off the two lists are identical, the "no access" branch is
 * unreachable, and that is the kill switch behaving as designed rather than this
 * check being broken. Worth knowing before concluding the branch is dead code:
 * it was verified by turning the switch ON and signing in as a user with no
 * sales grant.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  const db = getDb()
  const [reachable, memberships] = await Promise.all([
    listMyWorkspaces(db, user.id, { app: APP_SLUG }),
    listMyWorkspaces(db, user.id),
  ])

  if (memberships.length === 0) {
    return (
      <Empty title="No workspace yet">
        <p>
          Your account exists, but it does not belong to a workspace. b/sales is
          internal and there is no self-serve sign-up: somebody has to invite you.
        </p>
        <p>
          Ask a workspace owner to invite <strong>{user.email}</strong>, then sign
          in again.
        </p>
      </Empty>
    )
  }

  if (reachable.length === 0) {
    return (
      <Empty title="No access to b/sales">
        <p>
          You are a member of {memberships.map((w) => w.name).join(', ')}, but
          b/sales has not been enabled for you there.
        </p>
        <p>
          A workspace owner can grant it from <strong>Workspace settings → Apps</strong>.
        </p>
      </Empty>
    )
  }

  return <>{children}</>
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <div className="space-y-3 text-sm text-muted-foreground">{children}</div>
        <a href="/api/auth/signout" className="inline-block text-sm text-primary underline">
          Sign out
        </a>
      </div>
    </div>
  )
}
