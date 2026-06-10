'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Check, ChevronsUpDown, Plus } from 'lucide-react'
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
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-primary/10 text-primary"
      style={{ width: size, height: size }}
    >
      {ws.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ws.logo_url} alt="" className="size-full object-cover" />
      ) : (
        <span style={{ fontSize: Math.round(size * 0.42), fontWeight: 600 }}>
          {(ws.name.trim()[0] ?? 'W').toUpperCase()}
        </span>
      )}
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
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent"
      >
        {active ? (
          <WsAvatar ws={active} size={22} />
        ) : (
          <div className="flex size-[22px] shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
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
                    <button
                      onClick={() => switchTo(w.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary"
                    >
                      <WsAvatar ws={w} size={24} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{w.name}</p>
                        <p className="truncate text-[10px] text-muted-foreground">
                          {w.key} · {w.member_role}
                        </p>
                      </div>
                      {isActive ? <Check size={14} className="shrink-0 text-primary" /> : null}
                    </button>
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
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-secondary"
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
