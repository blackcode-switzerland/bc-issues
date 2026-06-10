'use client'

import { useEffect, useState } from 'react'
import { signOut, useSession } from 'next-auth/react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
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
  Menu,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useQuery } from '@tanstack/react-query'
import { WorkspaceSwitcher } from './workspace-switcher'
import { InboxBadge } from './inbox-badge'

interface DashboardLayoutProps {
  children: React.ReactNode
}

const NAV_PRIMARY = [
  { href: '/dashboard/inbox', label: 'Inbox', icon: Inbox, trailing: true, match: (p: string) => p === '/dashboard/inbox' },
]

const NAV_WORKSPACE = [
  { href: '/dashboard', label: 'Projects', icon: LayoutGrid, match: (p: string) => p === '/dashboard' },
  { href: '/dashboard/milestones', label: 'Milestones', icon: Target, match: (p: string) => p === '/dashboard/milestones' || p.startsWith('/dashboard/milestones/') },
  { href: '/dashboard/issues', label: 'Issues', icon: List, match: (p: string) => p === '/dashboard/issues' || p.startsWith('/dashboard/issues/') },
  { href: '/dashboard/labels', label: 'Labels', icon: Tag, match: (p: string) => p === '/dashboard/labels' },
]

const NAV_MANAGE = [
  { href: '/dashboard/members', label: 'Members', icon: Users, match: (p: string) => p.startsWith('/dashboard/members') },
  { href: '/dashboard/activity', label: 'Activity', icon: Clock, match: (p: string) => p === '/dashboard/activity' },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3, match: (p: string) => p === '/dashboard/analytics' },
]

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { theme, setTheme } = useTheme()
  const pathname = usePathname()
  const { data: session } = useSession()
  const user = session?.user
  const [mobileOpen, setMobileOpen] = useState(false)

  // Close the mobile drawer on route change.
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

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

  const sidebar = (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex items-center gap-2 border-b border-sidebar-border px-3.5 py-3">
        <Image src="/logo.png" alt="blackcode" width={22} height={22} className="rounded-md" />
        <span className="text-sm font-semibold tracking-tight">blackcode</span>
      </div>

      {/* Workspace switcher / top */}
      <div className="flex items-center gap-1 px-3 py-3">
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher />
        </div>
        <button
          onClick={() => setMobileOpen(false)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent lg:hidden"
          aria-label="Close menu"
        >
          <X size={16} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <div className="space-y-0.5">
          {NAV_PRIMARY.map((item) => (
            <NavItem key={item.href} item={item} active={item.match(pathname ?? '')} />
          ))}
        </div>

        <SectionLabel>Workspace</SectionLabel>
        <div className="space-y-0.5">
          {NAV_WORKSPACE.map((item) => (
            <NavItem key={item.href} item={item} active={item.match(pathname ?? '')} />
          ))}
        </div>

        <SectionLabel>Manage</SectionLabel>
        <div className="space-y-0.5">
          {NAV_MANAGE.map((item) => (
            <NavItem key={item.href} item={item} active={item.match(pathname ?? '')} />
          ))}
        </div>
      </nav>

      {/* User */}
      <div className="border-t border-sidebar-border p-2.5">
        <div className="mb-1 flex items-center gap-2.5 px-1.5 py-1">
          <div className="size-7 shrink-0 overflow-hidden rounded-full border border-border bg-primary/10">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={displayName || 'You'} className="size-full object-cover" />
            ) : (
              <span className="flex size-full items-center justify-center text-xs font-medium text-primary">
                {initials}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium leading-tight">{displayName}</p>
            <p className="truncate text-[11px] leading-tight text-muted-foreground">{displayEmail}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <IconButton title="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </IconButton>
          <Link
            href="/dashboard/settings"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            title="Settings"
          >
            <Settings size={16} />
          </Link>
          <button
            onClick={() => signOut()}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed left-0 top-0 z-30 hidden h-full w-60 border-r border-sidebar-border bg-sidebar lg:block">
        {sidebar}
      </aside>

      {/* Mobile top bar (static so page-level sticky headers can take top-0) */}
      <header className="flex h-12 items-center gap-2 border-b border-border bg-background px-3 lg:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
          aria-label="Open menu"
        >
          <Menu size={18} />
        </button>
        <span className="text-sm font-semibold">blackcode</span>
      </header>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-sidebar-border bg-sidebar shadow-xl">
            {sidebar}
          </aside>
        </div>
      ) : null}

      {/* Main content */}
      <main className="lg:ml-60">{children}</main>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2.5 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
      {children}
    </p>
  )
}

function IconButton({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
    >
      {children}
    </button>
  )
}

function NavItem({
  item,
  active,
}: {
  item: { href: string; label: string; icon: LucideIcon; trailing?: boolean }
  active: boolean
}) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
        active
          ? 'bg-sidebar-accent text-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
      }`}
    >
      <Icon size={16} />
      <span className="flex-1 truncate">{item.label}</span>
      {item.trailing ? <InboxBadge /> : null}
    </Link>
  )
}
