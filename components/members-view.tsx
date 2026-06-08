'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Crown, Mail, UserPlus, X, Clock, AlertCircle, Copy, RefreshCw } from 'lucide-react'

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
  const [inviteEmail, setInviteEmail] = useState('')

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspace-invitations'] }),
  })

  const remove = useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/members/${userId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspace-members'] }),
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

  return (
    <div className="p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Members</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage who has access to <strong>{ws.name}</strong>.
        </p>
      </header>

      {isOwner ? (
        <section className="mb-8 rounded-lg border border-border bg-card/30 p-5">
          <h2 className="mb-3 text-sm font-medium">Invite a teammate</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (inviteEmail.trim()) invite.mutate(inviteEmail.trim())
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
                className="w-full rounded-md border border-border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <button
              type="submit"
              disabled={invite.isPending}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <UserPlus size={14} />
              Invite
            </button>
          </form>
        </section>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium">
          Active members <span className="text-muted-foreground">({members?.length ?? 0})</span>
        </h2>
        {!members ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card/30">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  {m.name?.[0]?.toUpperCase() ?? m.email[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {m.name ?? m.email}
                    {m.deleted_at ? (
                      <span className="ml-2 text-xs text-muted-foreground">(deleted)</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">{m.email}</p>
                </div>
                {m.role === 'owner' ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                    <Crown size={10} />
                    Owner
                  </span>
                ) : (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Member
                  </span>
                )}
                {isOwner && m.role !== 'owner' ? (
                  <button
                    onClick={() => {
                      if (confirm(`Remove ${m.email} from the workspace?`)) {
                        remove.mutate(m.user_id)
                      }
                    }}
                    className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-destructive"
                    title="Remove"
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isOwner && pendingInvitations.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-medium">
            Pending invitations <span className="text-muted-foreground">({pendingInvitations.length})</span>
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card/30">
            {pendingInvitations.map((inv) => {
              const acceptUrl =
                typeof window !== 'undefined'
                  ? `${window.location.origin}/invitations/${inv.token}`
                  : `/invitations/${inv.token}`
              return (
                <li key={inv.id} className="flex items-center gap-3 px-4 py-3">
                  <Clock size={14} className="shrink-0 text-muted-foreground" />
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
                    className="rounded p-1 text-muted-foreground hover:bg-secondary"
                    title="Copy invite link"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={() => revoke.mutate(inv.id)}
                    className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-destructive"
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

      {/* Reserved icons */}
      <span className="hidden">
        <AlertCircle />
        <RefreshCw />
      </span>
    </div>
  )
}
