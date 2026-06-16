'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Crown, Search, UserPlus, X, Clock, Copy, Info } from 'lucide-react'
import { format } from 'date-fns'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { MemberAvatar } from '@/components/ui/member-avatar'

interface Workspace {
  id: number
  name: string
  slug: string
  key: string
  member_role: 'owner' | 'member'
}

interface Member {
  id: number
  user_id: number
  role: 'owner' | 'member'
  joined_at: string
  email: string
  name: string | null
  avatar_url: string | null
  deleted_at: string | null
}

interface Invitation {
  id: number
  email: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired' | 'declined'
  token: string
  expires_at: string
  created_at: string
  invited_by_email: string | null
}

async function fetchActiveWorkspace(): Promise<Workspace | null> {
  const meRes = await fetch('/api/me')
  if (!meRes.ok) return null
  const me = await meRes.json()
  if (!me.active_workspace_id) return null
  const wsRes = await fetch('/api/me/workspaces')
  if (!wsRes.ok) return null
  const { data } = await wsRes.json()
  return (data as Workspace[]).find((w) => w.id === me.active_workspace_id) ?? null
}

export function MembersView() {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [search, setSearch] = useState('')

  const { data: ws } = useQuery({ queryKey: ['active-workspace'], queryFn: fetchActiveWorkspace })

  const { data: members } = useQuery({
    queryKey: ['workspace-members', ws?.slug],
    enabled: !!ws,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/members`)
      if (!res.ok) throw new Error('failed')
      const j = await res.json()
      return j.data as Member[]
    },
  })

  const { data: invitations } = useQuery({
    queryKey: ['workspace-invitations', ws?.slug],
    enabled: !!ws && ws.member_role === 'owner',
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/invitations`)
      if (!res.ok) throw new Error('failed')
      const j = await res.json()
      return j.data as Invitation[]
    },
  })

  const revoke = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/invitations/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      toast.success('Invitation revoked')
      queryClient.invalidateQueries({ queryKey: ['workspace-invitations'] })
    },
    onError: () => toast.error('Could not revoke invitation'),
  })

  const remove = useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/members/${userId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      toast.success('Member removed')
      queryClient.invalidateQueries({ queryKey: ['workspace-members'] })
    },
    onError: () => toast.error('Failed to remove member'),
  })

  const filteredMembers = useMemo(() => {
    if (!members) return []
    if (!search.trim()) return members
    const q = search.toLowerCase()
    return members.filter(
      (m) => m.email.toLowerCase().includes(q) || (m.name ?? '').toLowerCase().includes(q)
    )
  }, [members, search])

  if (!ws) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">No active workspace.</p>
      </div>
    )
  }

  const isOwner = ws.member_role === 'owner'
  const pendingInvitations = invitations?.filter((i) => i.status === 'pending') ?? []

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2.5 border-b border-border bg-background/80 px-4 backdrop-blur">
        <h1 className="text-[15px] font-semibold">Members</h1>
        <span className="flex items-center justify-center rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium tabular-nums text-foreground/70 ring-1 ring-border/60">{members?.length ?? 0}</span>
        {isOwner ? (
          <Link
            href="/dashboard/members/invite"
            className="ml-auto flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <UserPlus size={15} />
            Invite members
          </Link>
        ) : null}
      </header>

      {/* Scope notice */}
      <div className="flex items-start gap-2 border-b border-border bg-secondary/30 px-6 py-2.5 text-xs text-muted-foreground">
        <Info size={14} className="mt-px shrink-0 text-muted-foreground" />
        <p>
          These are the members of <span className="font-medium text-foreground">{ws.name}</span> only.
          People in other workspaces aren&apos;t shown here.
        </p>
      </div>

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
      </div>

      {!members ? (
        <p className="px-6 py-4 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div>
          {/* Column header */}
          <div className="hidden items-center gap-3 border-b border-border px-6 py-2.5 text-[13px] font-medium text-muted-foreground sm:flex">
            <span className="flex-1">Name</span>
            <span className="hidden w-56 shrink-0 md:block">Email</span>
            <span className="w-24 shrink-0">Role</span>
            <span className="hidden w-28 shrink-0 lg:block">Joined</span>
            {isOwner ? <span className="w-6 shrink-0" /> : null}
          </div>
          <ul>
            {filteredMembers.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 border-b border-border/50 px-6 py-2.5 transition-colors hover:bg-secondary/40"
              >
                <MemberAvatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.name ?? m.email}
                    {m.deleted_at ? (
                      <span className="ml-2 text-xs text-muted-foreground">(deleted)</span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>
                <span className="hidden w-56 shrink-0 truncate text-sm text-muted-foreground md:block">
                  {m.email}
                </span>
                <span className="w-24 shrink-0">
                  {m.role === 'owner' ? (
                    <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-500">
                      <Crown size={10} />
                      Owner
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      Member
                    </span>
                  )}
                </span>
                <span
                  className="hidden w-28 shrink-0 text-sm text-muted-foreground lg:block"
                  suppressHydrationWarning
                >
                  {m.joined_at ? format(new Date(m.joined_at), 'MMM d, yyyy') : '—'}
                </span>
                {isOwner ? (
                  m.role !== 'owner' ? (
                    <button
                      onClick={async () => {
                        if (
                          await confirm({
                            title: `Remove ${m.name ?? m.email}?`,
                            description: 'They will lose access to this workspace.',
                            destructive: true,
                            confirmLabel: 'Remove',
                          })
                        ) {
                          remove.mutate(m.user_id)
                        }
                      }}
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive"
                      title="Remove"
                    >
                      <X size={14} />
                    </button>
                  ) : (
                    <span className="w-6 shrink-0" />
                  )
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isOwner && pendingInvitations.length > 0 ? (
        <section>
          <h2 className="border-y border-border bg-secondary/30 px-6 py-1.5 text-[13px] font-medium text-muted-foreground">
            Pending invitations · {pendingInvitations.length}
          </h2>
          <ul>
            {pendingInvitations.map((inv) => {
              const acceptUrl =
                typeof window !== 'undefined'
                  ? `${window.location.origin}/invitations/${inv.token}`
                  : `/invitations/${inv.token}`
              return (
                <li
                  key={inv.id}
                  className="flex items-center gap-3 border-b border-border/50 px-6 py-2.5 transition-colors hover:bg-secondary/40"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border">
                    <Clock size={13} className="text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{inv.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Expires{' '}
                      <span suppressHydrationWarning>
                        {new Date(inv.expires_at).toLocaleDateString()}
                      </span>
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(acceptUrl)
                      toast.success('Invite link copied')
                    }}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
                    title="Copy invite link"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={() => revoke.mutate(inv.id)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive"
                    title="Revoke"
                  >
                    <X size={14} />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
