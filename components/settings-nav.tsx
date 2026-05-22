'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/dashboard/settings/profile', label: 'Profile' },
  { href: '/dashboard/settings/account', label: 'Account' },
  { href: '/dashboard/settings/tokens', label: 'API tokens' },
  { href: '/dashboard/settings/workspace', label: 'Workspace' },
]

export function SettingsNav() {
  const pathname = usePathname()
  return (
    <nav className="flex flex-wrap gap-1 border-b border-border">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname?.startsWith(t.href + '/')
        return (
          <Link
            key={t.href}
            href={t.href}
            prefetch={false}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
