'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { seg: 'profile', label: 'Profile' },
  { seg: 'account', label: 'Account' },
  { seg: 'tokens', label: 'API tokens' },
  { seg: 'preferences', label: 'Preferences' },
]

export function SettingsNav() {
  const pathname = usePathname() ?? ''
  return (
    <nav className="flex gap-1 border-b border-border">
      {TABS.map((t) => {
        const href = `/dashboard/settings/${t.seg}`
        const active = pathname === href
        return (
          <Link
            key={t.seg}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors ' +
              (active
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground')
            }
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
