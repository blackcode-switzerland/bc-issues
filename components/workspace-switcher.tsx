'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, ChevronsUpDown, Plus, Settings } from 'lucide-react'
import Link from 'next/link'
import { avatarColor } from '@/components/ui/member-avatar'
import { toast } from 'sonner'
import { WorkspaceCreateModal } from './workspace-create-modal'

interface WorkspaceItem {
  id: number
  name: string
  slug: string
  key: string
  logo_url: string | null
  member_role: 'owner' | 'member'
}

async function fetchWorkspaces(): Promise<WorkspaceItem[]> {
  const res = await fetch('/api/me/workspaces')
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
      <div className="shrink-0 overflow-hidden rounded-md" style={{ width: size, height: size }}>
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

export function WorkspaceSwitcher() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const { data: workspaces } = useQuery({ queryKey: ['me-workspaces'], queryFn: fetchWorkspaces })
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: fetchMe })
  const active = workspaces?.find((w) => w.id === me?.active_workspace_id) ?? workspaces?.[0]

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function switchTo(workspaceId: number) {
    if (workspaceId === me?.active_workspace_id) {
      setOpen(false)
      return
    }
    const res = await fetch('/api/me/active-workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId }),
    })
    if (!res.ok) {
      toast.error('Failed to switch workspace')
      return
    }
    setOpen(false)
    await queryClient.invalidateQueries()
    router.refresh()
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent"
      >
        {active ? (
          <WsAvatar ws={active} size={22} />
        ) : (
          <div className="flex size-[22px] shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
            <Building2 size={13} />
          </div>
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {active?.name ?? 'No workspace'}
        </span>
        <ChevronsUpDown size={13} className="shrink-0 text-muted-foreground" />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          {workspaces && workspaces.length > 0 ? (
            <ul className="max-h-64 overflow-y-auto py-1">
              {workspaces.map((w) => {
                const isActive = w.id === me?.active_workspace_id
                return (
                  <li key={w.id}>
                    <div className={`flex items-center gap-2 px-3 py-2 text-sm ${isActive ? 'bg-primary/10 text-primary' : 'hover:bg-secondary'}`}>
                      <button
                        onClick={() => switchTo(w.id)}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                      >
                        <WsAvatar ws={w} size={24} />
                        <div className="min-w-0 flex-1">
                          <p className={`truncate font-medium ${isActive ? 'text-primary' : ''}`}>{w.name}</p>
                          <p className={`truncate text-[10px] ${isActive ? 'text-primary/60' : 'text-muted-foreground'}`}>
                            {w.key} · {w.member_role}
                          </p>
                        </div>
                      </button>
                      {isActive ? (
                        <Link
                          href="/dashboard/settings/workspace"
                          onClick={() => setOpen(false)}
                          title="Workspace settings"
                          className="cursor-pointer shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                        >
                          <Settings size={13} />
                        </Link>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : null}

          <div className="border-t border-border">
            <button
              onClick={() => {
                setOpen(false)
                setShowCreate(true)
              }}
              className="cursor-pointer flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-secondary"
            >
              <Plus size={14} />
              Create workspace
            </button>
          </div>
        </div>
      ) : null}

      <WorkspaceCreateModal open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  )
}
