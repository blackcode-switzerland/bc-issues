import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { isSuperAdmin } from '@/lib/auth/whitelist'
import { SuperAdminNav } from '@/components/super-admin-nav'
import { ShieldCheck } from 'lucide-react'

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getValidatedSessionUser()
  if (!user || !isSuperAdmin(user.email)) redirect('/dashboard')

  return (
    <div>
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="flex h-12 items-center gap-3 px-6">
          <h1 className="text-[15px] font-semibold">Super Admin</h1>
          <span className="ml-1 text-[13px] text-muted-foreground">
            Only members with super admin access can view this page.
          </span>
        </div>
        <div className="flex items-center gap-2 border-b border-border bg-primary/5 px-6 py-2 text-[13px] text-primary/80">
          <ShieldCheck size={13} className="shrink-0" />
          Changes and data here affect the entire platform, across all workspaces.
        </div>
        <SuperAdminNav />
      </header>
      {children}
    </div>
  )
}
