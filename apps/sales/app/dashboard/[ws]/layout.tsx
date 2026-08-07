import { notFound, redirect } from 'next/navigation'
import { listMyWorkspaces } from '@blackcode/platform-db'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { APP_SLUG } from '@/lib/app'
import { SalesShell } from '@/components/sales-shell'

/**
 * The workspace frame.
 *
 * A slug in the URL is user input, so it is checked here rather than trusted:
 * an unreachable one is a **404**, not a 403. A 403 confirms the workspace
 * exists, and for a workspace this person is not in, its existence is exactly
 * the fact that must not leak. The API layer settles the same question the same
 * way (`getWorkspaceForUser` returns null for both cases and lets the caller
 * choose), so the two surfaces agree.
 *
 * Reachability is app-scoped: being a member of a workspace where `sales` is off
 * is not access to this page.
 */
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

  const reachable = await listMyWorkspaces(getDb(), user.id, { app: APP_SLUG })
  if (!reachable.some((w) => w.slug === ws)) notFound()

  return <SalesShell ws={ws}>{children}</SalesShell>
}
