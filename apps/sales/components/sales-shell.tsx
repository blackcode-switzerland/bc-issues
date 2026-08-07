'use client'

// The frame every dashboard page sits in: fixed left sidebar, content right.
//
// ── WHAT IS NOT HERE, AND WHY ───────────────────────────────────────────────
// **No workspace switcher and no create-workspace flow** (D-3). Sales keeps
// workspaces in the data model — every route is `/api/workspaces/{ws}/…`, every
// URN embeds the slug — and takes them out of the UI. A human working here sees
// a single-tenant product; the platform sees no change at all. `app/dashboard/
// page.tsx` resolves the one workspace and redirects.
//
// **No AI, no chat box, no approve button** (§1.2 rule 1). The mockup shipped an
// approval UI twice by accident and removed it twice; the shell is where such a
// thing would naturally be bolted on, so it is worth saying here.
//
// ── DENSITY IS A COMPONENT CONVENTION, AND THIS IS WHERE IT IS SET ──────────
// D-4 gives sales `h-12` header and `py-3` rows against issues' `h-11` and tight
// ones. Tokens cannot express that — `--radius` and the palette are in
// globals.css, but spacing is chosen per component — so the header height below
// and the row padding in every listing are the carriers.

import { createContext, useContext, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import { useTheme } from 'next-themes'
import {
  Activity,
  BarChart3,
  Building2,
  CalendarClock,
  FileText,
  FolderOpen,
  LogOut,
  MessagesSquare,
  Moon,
  Package,
  Menu,
  Sun,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'

/** `seg` is the path under `/dashboard/{ws}`; '' is Today. */
interface NavEntry {
  seg: string
  label: string
  icon: LucideIcon
}

const NAV_MAIN: NavEntry[] = [
  { seg: '', label: 'Today', icon: Sparkles },
  { seg: '/metrics', label: 'Metrics', icon: BarChart3 },
  { seg: '/prospects', label: 'Prospects', icon: Building2 },
  { seg: '/meetings', label: 'Meetings', icon: CalendarClock },
  { seg: '/communications', label: 'Communications', icon: MessagesSquare },
  { seg: '/activity', label: 'Activity', icon: Activity },
]

const NAV_CATALOG: NavEntry[] = [
  { seg: '/products', label: 'Products', icon: Package },
  { seg: '/templates', label: 'Templates', icon: FileText },
  { seg: '/documents', label: 'Documents', icon: FolderOpen },
]

/**
 * The header title.
 *
 * Derived from the nav table for the pages that are IN it, and overridable for
 * the ones that are not — a prospect detail page's title is a company name and
 * no static table can hold it. Defaulting to the nav label rather than requiring
 * every page to set one means a new page gets a correct header for free and a
 * forgotten `usePageTitle` shows the section name, not an empty bar.
 */
const PageTitleContext = createContext<(title: string | null) => void>(() => {})

export function usePageTitle(title: string | null) {
  const set = useContext(PageTitleContext)
  useEffect(() => {
    set(title)
    return () => set(null)
  }, [set, title])
}

export function SalesShell({ ws, children }: { ws: string; children: React.ReactNode }) {
  const pathname = usePathname() ?? ''
  const base = `/dashboard/${ws}`
  const [mobileOpen, setMobileOpen] = useState(false)
  const [override, setOverride] = useState<string | null>(null)

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  const navTitle =
    [...NAV_MAIN, ...NAV_CATALOG].find((e) => isActive(pathname, base, e.seg))?.label ?? 'b/sales'

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <Link
        href={base}
        className="flex h-12 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-sidebar-primary text-[11px] font-semibold text-sidebar-primary-foreground">
          b/
        </span>
        <span className="text-[15px] font-semibold tracking-tight">sales</span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        <div className="space-y-0.5">
          {NAV_MAIN.map((e) => (
            <NavLink key={e.seg} entry={e} base={base} pathname={pathname} />
          ))}
        </div>

        <p className="px-2.5 pb-1.5 pt-5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Catalog
        </p>
        <div className="space-y-0.5">
          {NAV_CATALOG.map((e) => (
            <NavLink key={e.seg} entry={e} base={base} pathname={pathname} />
          ))}
        </div>
      </nav>

      <AccountFooter />
    </div>
  )

  return (
    <PageTitleContext.Provider value={setOverride}>
      <div className="min-h-screen bg-background">
        {/* Desktop rail */}
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 border-r border-sidebar-border lg:block">
          {sidebar}
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              aria-label="Close menu"
              className="absolute inset-0 bg-black/50"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="absolute inset-y-0 left-0 w-60 border-r border-sidebar-border">
              {sidebar}
            </aside>
          </div>
        )}

        <div className="lg:pl-56">
          {/* h-12, the sales density (D-4). Sticky, so the section name stays
              visible down a long ledger. */}
          <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur">
            <button
              onClick={() => setMobileOpen(true)}
              className="-ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-accent lg:hidden"
              aria-label="Open menu"
            >
              <Menu size={17} />
            </button>
            <h1 className="truncate text-sm font-medium text-foreground">{override ?? navTitle}</h1>
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
            </div>
          </header>

          <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </PageTitleContext.Provider>
  )
}

/**
 * Active-state matching.
 *
 * Today (`seg: ''`) is an EXACT match and everything else is a prefix, because a
 * plain `startsWith` would light Today up on every page under it. The prefix has
 * to be boundary-aware too: `/prospects` must not match `/prospects-archive`,
 * and a listing gaining a sibling route is exactly how that becomes true later.
 */
function isActive(pathname: string, base: string, seg: string): boolean {
  const href = base + seg
  if (seg === '') return pathname === base || pathname === base + '/'
  return pathname === href || pathname.startsWith(href + '/')
}

function NavLink({ entry, base, pathname }: { entry: NavEntry; base: string; pathname: string }) {
  const active = isActive(pathname, base, entry.seg)
  const Icon = entry.icon
  return (
    <Link
      href={base + entry.seg}
      aria-current={active ? 'page' : undefined}
      className={
        // py-2 rather than issues' py-1.5 — roomier is the point (D-4).
        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ' +
        (active
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground')
      }
    >
      <Icon size={16} className={active ? 'text-sidebar-primary' : ''} />
      {entry.label}
    </Link>
  )
}

// No Settings link yet. `/dashboard/settings/*` is a later Phase 7 group, and a
// nav item pointing at a route that does not exist is a 404 wearing a working
// app's clothes — the same failure mode the two empties in
// `app/dashboard/layout.tsx` are shaped around. It goes in with the page.
function AccountFooter() {
  const { data: session } = useSession()
  const user = session?.user
  return (
    <div className="shrink-0 border-t border-sidebar-border p-2.5">
      <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-[11px] font-medium">
          {(user?.name ?? user?.email ?? '?').charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{user?.name ?? 'Signed in'}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{user?.email}</span>
        </span>
      </div>
      <button
        onClick={() => signOut({ callbackUrl: '/login' })}
        className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      >
        <LogOut size={15} />
        Sign out
      </button>
    </div>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  // `next-themes` cannot know the resolved theme until it has read the DOM, so
  // rendering the icon before mount produces a server/client mismatch and a
  // hydration warning. Rendering a same-sized blank keeps the header from
  // shifting when it arrives.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <button
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      aria-label="Toggle theme"
    >
      {mounted ? (
        resolvedTheme === 'dark' ? (
          <Sun size={16} />
        ) : (
          <Moon size={16} />
        )
      ) : (
        <span className="block h-4 w-4" />
      )}
    </button>
  )
}
