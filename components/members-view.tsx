'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Crown, Mail, Search, UserPlus, X, Clock, Copy } from 'lucide-react'
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
  const [inviteEmail, setInviteEmail] = useState('')
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

  const invite = useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'failed')
      }
      return res.json()
    },
    onSuccess: (r) => {
      if (r.email_sent) {
        toast.success(
          r.invitee_has_account
            ? 'Invitation emailed — also in their inbox'
            : 'Invitation email sent'
        )
      } else {
        toast.success(
          r.invitee_has_account
            ? 'Invitation sent — appears in their inbox'
            : 'Invitation created — share the link below'
        )
      }
      setInviteEmail('')
      queryClient.invalidateQueries({ queryKey: ['workspace-invitations'] })
    },
    onError: (e: Error) => toast.error(e.message),
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

  if (!ws) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">No active workspace.</p>
      </div>
    )
  }

  const isOwner = ws.member_role === 'owner'
  const pendingInvitations = invitations?.filter((i) => i.status === 'pending') ?? []

  const filteredMembers = useMemo(() => {
    if (!members) return []
    if (!search.trim()) return members
    const q = search.toLowerCase()
    return members.filter(
      (m) => m.email.toLowerCase().includes(q) || (m.name ?? '').toLowerCase().includes(q)
    )
  }, [members, search])

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-11 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur">
        <h1 className="text-sm font-semibold">Members</h1>
        <span className="text-xs text-muted-foreground">{members?.length ?? 0}</span>
        {isOwner ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (inviteEmail.trim()) invite.mutate(inviteEmail.trim())
            }}
            className="ml-auto flex items-center gap-2"
          >
            <div className="relative hidden sm:block">
              <Mail size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Invite by email…"
                className="h-8 w-52 rounded-md border border-border bg-transparent pl-8 pr-2.5 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <button
              type="submit"
              disabled={invite.isPending}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <UserPlus size={13} />
              Invite
            </button>
          </form>
        ) : null}
      </header>

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
          <div className="hidden items-center gap-3 border-b border-border px-6 py-2 text-xs font-medium text-muted-foreground sm:flex">
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
          <h2 className="border-y border-border bg-secondary/30 px-6 py-1.5 text-xs font-medium text-muted-foreground">
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
