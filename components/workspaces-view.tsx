'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Check, ChevronRight, Loader2, Plus, Settings } from 'lucide-react'
import { toast } from 'sonner'
import { avatarColor } from '@/components/ui/member-avatar'

interface WorkspaceItem {
  id: number
  name: string
  slug: string
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
      style={{ width: size, height: size, backgroundColor: avatarColor(ws.name), fontSize: Math.round(size * 0.4) }}
    >
      {(ws.name.trim()[0] ?? 'W').toUpperCase()}
    </div>
  )
}

export function WorkspacesView() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [switchingId, setSwitchingId] = useState<number | null>(null)

  const { data: workspaces, isLoading } = useQuery({ queryKey: ['me-workspaces'], queryFn: fetchWorkspaces })
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: fetchMe })

  async function switchTo(workspaceId: number) {
    if (workspaceId === me?.active_workspace_id) return
    const target = workspaces?.find((w) => w.id === workspaceId)
    setSwitchingId(workspaceId)
    try {
      const res = await fetch('/api/me/active-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId }),
      })
      if (!res.ok) {
        toast.error('Failed to switch workspace')
        return
      }
      await queryClient.invalidateQueries()
      // Navigate into the workspace — the URL is the source of truth now.
      if (target) router.push(`/dashboard/${target.slug}`)
      else router.refresh()
    } finally {
      setSwitchingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Workspaces</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Switch between your workspaces or manage their settings.
          </p>
        </div>
        <Link
          href="/dashboard/workspaces/new"
          className="cursor-pointer inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus size={15} />
          Create workspace
        </Link>
      </header>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !workspaces || workspaces.length === 0 ? (
        <div className="rounded-lg border border-border py-16 text-center">
          <Building2 size={28} className="mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">You don&apos;t belong to any workspaces yet.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {workspaces.map((w) => {
            const isActive = w.id === me?.active_workspace_id
            const isSwitching = switchingId === w.id
            return (
              <li
                key={w.id}
                className={`flex items-center gap-3 rounded-lg border px-3 py-3 transition-colors ${
                  isActive ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-secondary/40'
                }`}
              >
                <button
                  onClick={() => switchTo(w.id)}
                  disabled={isActive || isSwitching}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
                  title={isActive ? 'Current workspace' : 'Switch to this workspace'}
                >
                  <WsAvatar ws={w} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {w.name}
                      {isActive ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          <Check size={11} />
                          Active
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {w.member_role}
                    </p>
                  </div>
                </button>

                {isSwitching ? (
                  <Loader2 size={16} className="shrink-0 animate-spin text-muted-foreground" />
                ) : !isActive ? (
                  <button
                    onClick={() => switchTo(w.id)}
                    className="cursor-pointer hidden shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:inline-flex"
                  >
                    Switch
                  </button>
                ) : null}

                {w.member_role === 'owner' ? (
                  <Link
                    href={`/dashboard/workspaces/${w.slug}`}
                    className="cursor-pointer inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-secondary"
                    title="Manage workspace"
                  >
                    <Settings size={13} />
                    <span className="hidden sm:inline">Manage</span>
                    <ChevronRight size={13} className="text-muted-foreground sm:hidden" />
                  </Link>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

    </div>
  )
}
