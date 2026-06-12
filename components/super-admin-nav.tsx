'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/dashboard/super-admin/users', label: 'All Members' },
  { href: '/dashboard/super-admin/whitelist', label: 'Access Whitelist' },
]

export function SuperAdminNav() {
  const pathname = usePathname()
  return (
    <nav className="flex gap-1 px-6">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname?.startsWith(t.href + '/')
        return (
          <Link
            key={t.href}
            href={t.href}
            prefetch={false}
            className={`-mb-px border-b-2 px-3 py-2.5 text-[14px] ${
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
