'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Search, Building2 } from 'lucide-react'
import { MemberAvatar } from '@/components/ui/member-avatar'

interface PlatformUser {
  id: number
  name: string | null
  email: string
  avatar_url: string | null
  created_at: string | null
  last_login: string | null
  workspace_count: number
  is_super_admin: boolean
}

export function SuperAdminUsersView() {
  const [search, setSearch] = useState('')

  const { data: users, isLoading } = useQuery({
    queryKey: ['super-admin-users'],
    queryFn: async () => {
      const res = await fetch('/api/super-admin/users')
      if (!res.ok) throw new Error('failed')
      const j = await res.json()
      return j.data as PlatformUser[]
    },
  })

  const filtered = useMemo(() => {
    if (!users) return []
    if (!search.trim()) return users
    const q = search.toLowerCase()
    return users.filter(
      (u) => u.email.toLowerCase().includes(q) || (u.name ?? '').toLowerCase().includes(q)
    )
  }, [users, search])

  return (
    <div>
      {/* Search bar */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-primary"
          />
        </div>
        {users && (
          <span className="ml-auto flex items-center justify-center rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium tabular-nums text-foreground/70 ring-1 ring-border/60">
            {filtered.length}
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="px-6 py-4 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div>
          {/* Column header */}
          <div className="hidden items-center gap-3 border-b border-border px-6 py-2.5 text-[13px] font-medium text-muted-foreground sm:flex">
            <span className="flex-1">Member</span>
            <span className="hidden w-56 shrink-0 md:block">Email</span>
            <span className="w-28 shrink-0">Workspaces</span>
            <span className="hidden w-28 shrink-0 lg:block">Last login</span>
            <span className="hidden w-28 shrink-0 lg:block">Joined</span>
          </div>
          <ul>
            {filtered.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 border-b border-border/50 px-6 py-2.5 transition-colors hover:bg-secondary/40"
              >
                <MemberAvatar name={u.name} email={u.email} avatarUrl={u.avatar_url} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{u.name ?? u.email}</p>
                    {u.is_super_admin && (
                      <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                        Super Admin
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground sm:hidden">{u.email}</p>
                </div>
                <span className="hidden w-56 shrink-0 truncate text-sm text-muted-foreground md:block">
                  {u.email}
                </span>
                <span className="w-28 shrink-0">
                  <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Building2 size={13} />
                    {u.workspace_count}
                  </span>
                </span>
                <span
                  className="hidden w-28 shrink-0 text-sm text-muted-foreground lg:block"
                  suppressHydrationWarning
                >
                  {u.last_login ? format(new Date(u.last_login), 'MMM d, yyyy') : '—'}
                </span>
                <span
                  className="hidden w-28 shrink-0 text-sm text-muted-foreground lg:block"
                  suppressHydrationWarning
                >
                  {u.created_at ? format(new Date(u.created_at), 'MMM d, yyyy') : '—'}
                </span>
              </li>
            ))}
          </ul>
          {filtered.length === 0 && !isLoading && (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">No members found.</p>
          )}
        </div>
      )}
    </div>
  )
}
