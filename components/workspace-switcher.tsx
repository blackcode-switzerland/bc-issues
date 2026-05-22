'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Check, ChevronsUpDown, Plus } from 'lucide-react'
import { toast } from 'sonner'

interface WorkspaceItem {
  id: number
  name: string
  slug: string
  key: string
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

export function WorkspaceSwitcher() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const { data: workspaces } = useQuery({ queryKey: ['me-workspaces'], queryFn: fetchWorkspaces })
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: fetchMe })
  const active = workspaces?.find((w) => w.id === me?.active_workspace_id) ?? workspaces?.[0]

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false)
        setCreating(false)
      }
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

  async function createWorkspace(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      toast.error(j.error ?? 'Failed to create workspace')
      return
    }
    const created = await res.json()
    setNewName('')
    setCreating(false)
    setOpen(false)
    await fetch('/api/me/active-workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: created.id }),
    })
    await queryClient.invalidateQueries()
    router.refresh()
    toast.success(`Created "${created.name}"`)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-card/30 px-3 py-2 text-left transition-colors hover:bg-secondary"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Building2 size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{active?.name ?? 'No workspace'}</p>
          <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
            {active ? `${active.key} · ${active.member_role}` : 'Create one to start'}
          </p>
        </div>
        <ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />
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
                      <div className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-medium text-primary">
                        {w.key.slice(0, 2)}
                      </div>
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
            {creating ? (
              <form onSubmit={createWorkspace} className="p-2">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Workspace name"
                  maxLength={80}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    className="rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-secondary"
              >
                <Plus size={14} />
                Create workspace
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
