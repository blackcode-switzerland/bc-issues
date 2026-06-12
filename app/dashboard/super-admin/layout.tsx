import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { isSuperAdmin } from '@/lib/auth/whitelist'
import { SuperAdminNav } from '@/components/super-admin-nav'

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getValidatedSessionUser()
  if (!user || !isSuperAdmin(user.email)) redirect('/dashboard')

  return (
    <div>
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="flex h-12 items-center gap-3 px-6">
          <h1 className="text-[15px] font-semibold">Super Admin</h1>
          <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-500">
            Internal
          </span>
        </div>
        <SuperAdminNav />
      </header>
      {children}
    </div>
  )
}
