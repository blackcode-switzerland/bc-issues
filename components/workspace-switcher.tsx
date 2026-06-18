'use client'

import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Building2, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { avatarColor } from '@/components/ui/member-avatar'

interface WorkspaceItem {
  id: number
  name: string
  slug: string
  key: string
  logo_url: string | null
  member_role: 'owner' | 'member'
}

async function fetchWorkspaces(): Promise<WorkspaceItem[]> {
  const res = await fetch('/api/workspaces')
  if (!res.ok) throw new Error('failed')
  const j = await res.json()
  return j.data
}

async function fetchMe(): Promise<{ active_workspace_id: number | null }> {
  const res = await fetch('/api/me')
  if (!res.ok) throw new Error('failed')
  return res.json()
}

function WsAvatar({ ws, size }: { ws: WorkspaceItem; size: number }) {
  if (ws.logo_url) {
    return (
      <div
        className="shrink-0 overflow-hidden rounded-md bg-zinc-700 ring-1 ring-inset ring-border"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ws.logo_url} alt={ws.name} className="size-full object-cover" />
      </div>
    )
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-md font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: avatarColor(ws.name), fontSize: Math.round(size * 0.42) }}
    >
      {(ws.name.trim()[0] ?? 'W').toUpperCase()}
    </div>
  )
}

// Sidebar entry point for workspaces. Rather than a dropdown, this links to the
// dedicated /dashboard/workspaces page where the user can switch or manage any
// workspace.
export function WorkspaceSwitcher() {
  const pathname = usePathname()
  const onWorkspacesPage = pathname?.startsWith('/dashboard/workspaces') ?? false

  const { data: workspaces } = useQuery({ queryKey: ['me-workspaces'], queryFn: fetchWorkspaces })
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: fetchMe })
  const active = workspaces?.find((w) => w.id === me?.active_workspace_id) ?? workspaces?.[0]

  return (
    <Link
      href="/dashboard/workspaces"
      className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent ${
        onWorkspacesPage ? 'bg-sidebar-accent' : ''
      }`}
    >
      {active ? (
        <WsAvatar ws={active} size={24} />
      ) : (
        <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
          <Building2 size={14} />
        </div>
      )}
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{active?.name ?? 'No workspace'}</span>
      <ChevronRight size={14} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}
