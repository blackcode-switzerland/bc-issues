'use client'

import { signOut, useSession } from 'next-auth/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Image from 'next/image'
import {
  Settings,
  LogOut,
  Moon,
  Sun,
  LayoutGrid,
  List,
  Target,
  BarChart3,
  Clock,
  Inbox,
  Users,
  Tag,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useQuery } from '@tanstack/react-query'
import { WorkspaceSwitcher } from './workspace-switcher'
import { InboxBadge } from './inbox-badge'

interface DashboardLayoutProps {
  children: React.ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { theme, setTheme } = useTheme()
  const pathname = usePathname()
  const { data: session } = useSession()
  const user = session?.user

  // Pull the live profile so the avatar/name reflect edits immediately (the
  // session JWT is only refreshed on re-login). Shares the ['me'] cache with
  // the profile settings page, so an upload there updates the sidebar too.
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/me')
      if (!res.ok) return null
      return res.json() as Promise<{
        name: string | null
        email: string
        avatar_url: string | null
      }>
    },
  })

  const displayName = me?.name ?? user?.name ?? ''
  const displayEmail = me?.email ?? user?.email ?? ''
  const avatarUrl = me?.avatar_url ?? user?.image ?? null
  const initials = (displayName.trim()[0] ?? displayEmail[0] ?? '?').toUpperCase()

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-64 bg-card border-r border-border flex flex-col z-30">
        {/* Logo */}
        <div className="p-4 border-b border-border">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="blackcode issues"
              width={32}
              height={32}
              className="rounded-lg"
            />
            <span className="font-bold">blackcode issues</span>
          </Link>
        </div>

        {/* Workspace switcher */}
        <div className="p-3 border-b border-border">
          <WorkspaceSwitcher />
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          <Link href="/dashboard/inbox" className="block">
            <NavItem
              icon={<Inbox size={18} />}
              label="Inbox"
              active={pathname === '/dashboard/inbox'}
              trailing={<InboxBadge />}
            />
          </Link>
          <div className="h-2" />
          <Link href="/dashboard" className="block">
            <NavItem
              icon={<LayoutGrid size={18} />}
              label="Projects"
              active={pathname === '/dashboard'}
            />
          </Link>
          <Link href="/dashboard/issues" className="block">
            <NavItem
              icon={<List size={18} />}
              label="Issues"
              active={pathname === '/dashboard/issues' || pathname?.startsWith('/dashboard/issues/')}
            />
          </Link>
          <Link href="/dashboard/milestones" className="block">
            <NavItem
              icon={<Target size={18} />}
              label="Milestones"
              active={pathname === '/dashboard/milestones' || pathname?.startsWith('/dashboard/milestones/')}
            />
          </Link>
          <Link href="/dashboard/labels" className="block">
            <NavItem
              icon={<Tag size={18} />}
              label="Labels"
              active={pathname === '/dashboard/labels'}
            />
          </Link>
          <div className="h-2" />
          <Link href="/dashboard/members" className="block">
            <NavItem
              icon={<Users size={18} />}
              label="Members"
              active={pathname?.startsWith('/dashboard/members') ?? false}
            />
          </Link>
          <Link href="/dashboard/activity" className="block">
            <NavItem
              icon={<Clock size={18} />}
              label="Activity"
              active={pathname === '/dashboard/activity'}
            />
          </Link>
          <Link href="/dashboard/analytics" className="block">
            <NavItem
              icon={<BarChart3 size={18} />}
              label="Analytics"
              active={pathname === '/dashboard/analytics'}
            />
          </Link>
        </nav>

        {/* User */}
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 mb-4">
            <div className="size-9 shrink-0 overflow-hidden rounded-full border border-border bg-primary/10">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={displayName || 'You'}
                  className="size-full object-cover"
                />
              ) : (
                <span className="flex size-full items-center justify-center text-sm font-medium text-primary">
                  {initials}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{displayName}</p>
              <p className="text-xs text-muted-foreground truncate">{displayEmail}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-2 hover:bg-secondary rounded-lg transition-colors"
              title="Toggle theme"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <Link
              href="/dashboard/settings"
              className="p-2 hover:bg-secondary rounded-lg transition-colors"
              title="Settings"
            >
              <Settings size={18} />
            </Link>
            <button
              onClick={() => signOut()}
              className="p-2 hover:bg-secondary rounded-lg transition-colors text-destructive"
              title="Sign out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-64">
        {children}
      </main>
    </div>
  )
}

function NavItem({
  icon,
  label,
  active = false,
  trailing,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  trailing?: React.ReactNode
}) {
  return (
    <div
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
      }`}
    >
      {icon}
      <span className="font-medium flex-1">{label}</span>
      {trailing}
    </div>
  )
}
