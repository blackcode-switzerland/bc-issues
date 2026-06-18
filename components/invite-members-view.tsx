'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Check, Globe, Mail, Search, UserPlus, Users } from 'lucide-react'
import { MemberAvatar } from '@/components/ui/member-avatar'

interface Workspace {
  id: number
  name: string
  slug: string
  member_role: 'owner' | 'member'
}

interface InviteCandidate {
  user_id: number
  email: string
  name: string | null
  avatar_url: string | null
  already_member: boolean
  invited: boolean
  shared_workspaces: string[]
  from_platform: boolean
}

async function fetchActiveWorkspace(): Promise<Workspace | null> {
  const meRes = await fetch('/api/me')
  if (!meRes.ok) return null
  const me = await meRes.json()
  if (!me.active_workspace_id) return null
  const wsRes = await fetch('/api/workspaces')
  if (!wsRes.ok) return null
  const { data } = await wsRes.json()
  return (data as Workspace[]).find((w) => w.id === me.active_workspace_id) ?? null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function InviteMembersView() {
  const queryClient = useQueryClient()
  const [inviteEmail, setInviteEmail] = useState('')
  const [search, setSearch] = useState('')

  const { data: ws } = useQuery({ queryKey: ['active-workspace'], queryFn: fetchActiveWorkspace })

  const { data: candidatesResp, isLoading: candidatesLoading } = useQuery({
    queryKey: ['invite-candidates', ws?.slug],
    enabled: !!ws && ws.member_role === 'owner',
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/invite-candidates`)
      if (!res.ok) throw new Error('failed')
      return res.json() as Promise<{ data: InviteCandidate[]; is_super_admin: boolean }>
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
            : 'Invitation created — share the link from the Members page'
        )
      }
      setInviteEmail('')
      queryClient.invalidateQueries({ queryKey: ['invite-candidates'] })
      queryClient.invalidateQueries({ queryKey: ['workspace-invitations'] })
    },
    onError: (e: Error) => {
      if (e.message.includes('approved list')) {
        toast.error('Email not in the approved list — contact a super admin to add it first.', {
          duration: 6000,
        })
      } else {
        toast.error(e.message)
      }
    },
  })

  const candidates = candidatesResp?.data ?? []
  const isSuperAdmin = candidatesResp?.is_super_admin ?? false

  const filtered = useMemo(() => {
    if (!search.trim()) return candidates
    const q = search.toLowerCase()
    return candidates.filter(
      (c) => c.email.toLowerCase().includes(q) || (c.name ?? '').toLowerCase().includes(q)
    )
  }, [candidates, search])

  // Shared-workspace people the UI groups separately from platform-only people.
  const shared = filtered.filter((c) => !c.from_platform)
  const platform = filtered.filter((c) => c.from_platform)

  if (!ws) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">No active workspace.</p>
      </div>
    )
  }

  if (ws.member_role !== 'owner') {
    return (
      <div>
        <Header />
        <div className="p-8">
          <p className="text-sm text-muted-foreground">
            Only the workspace owner can invite members.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header />

      <div className="mx-auto max-w-2xl px-6 py-8">
        {/* Invite by email */}
        <section>
          <h2 className="text-sm font-semibold">Invite by email</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Send an invitation to anyone by email. They&apos;ll get a link to join{' '}
            <span className="font-medium text-foreground">{ws.name}</span>
            {isSuperAdmin ? '.' : ' — only approved Blackcode emails can be invited.'}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const email = inviteEmail.trim().toLowerCase()
              if (!EMAIL_RE.test(email)) {
                toast.error('Enter a valid email address')
                return
              }
              invite.mutate(email)
            }}
            className="mt-3 flex items-center gap-2"
          >
            <div className="relative flex-1">
              <Mail
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@blackcode.ch"
                className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <button
              type="submit"
              disabled={invite.isPending}
              className="flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <UserPlus size={15} />
              Invite
            </button>
          </form>
        </section>

        {/* Search across suggestions */}
        <div className="relative mt-8">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people by name or email…"
            className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Shared-workspace people */}
        <CandidateSection
          title="From your other workspaces"
          description="People you already collaborate with in your other workspaces."
          icon={<Users size={14} />}
          loading={candidatesLoading}
          candidates={shared}
          emptyLabel={
            search
              ? 'No matching people in your other workspaces.'
              : 'No one to suggest from your other workspaces yet.'
          }
          onInvite={(email) => invite.mutate(email)}
          inviting={invite.isPending}
        />

        {/* Platform-wide (super admin only) */}
        {isSuperAdmin ? (
          <CandidateSection
            title="Everyone on the platform"
            description="As a super admin, you can invite any registered user directly."
            icon={<Globe size={14} />}
            loading={candidatesLoading}
            candidates={platform}
            emptyLabel={
              search ? 'No matching platform users.' : 'No other platform users.'
            }
            onInvite={(email) => invite.mutate(email)}
            inviting={invite.isPending}
          />
        ) : null}
      </div>
    </div>
  )
}

function Header() {
  return (
    <header className="sticky top-0 z-10 flex h-12 items-center gap-2.5 border-b border-border bg-background/80 px-4 backdrop-blur">
      <Link
        href="/dashboard/members"
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
        title="Back to members"
      >
        <ArrowLeft size={16} />
      </Link>
      <h1 className="text-[15px] font-semibold">Invite members</h1>
    </header>
  )
}

interface CandidateSectionProps {
  title: string
  description: string
  icon: React.ReactNode
  loading: boolean
  candidates: InviteCandidate[]
  emptyLabel: string
  onInvite: (email: string) => void
  inviting: boolean
}

function CandidateSection({
  title,
  description,
  icon,
  loading,
  candidates,
  emptyLabel,
  onInvite,
  inviting,
}: CandidateSectionProps) {
  return (
    <section className="mt-8">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <h2 className="text-[13px] font-medium uppercase tracking-wide">{title}</h2>
        <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] tabular-nums">
          {candidates.length}
        </span>
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>

      <ul className="mt-3 divide-y divide-border/60 rounded-md border border-border">
        {loading ? (
          <li className="px-4 py-3 text-sm text-muted-foreground">Loading…</li>
        ) : candidates.length === 0 ? (
          <li className="px-4 py-3 text-sm text-muted-foreground">{emptyLabel}</li>
        ) : (
          candidates.map((c) => (
            <li key={c.user_id} className="flex items-center gap-3 px-4 py-2.5">
              <MemberAvatar name={c.name} email={c.email} avatarUrl={c.avatar_url} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.name ?? c.email}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {c.email}
                  {c.shared_workspaces.length > 0 ? (
                    <span className="text-muted-foreground/70">
                      {' · '}
                      {c.shared_workspaces.join(', ')}
                    </span>
                  ) : null}
                </p>
              </div>
              {c.already_member ? (
                <span className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  <Check size={11} />
                  Already in
                </span>
              ) : c.invited ? (
                <span className="inline-flex items-center rounded border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  Invited
                </span>
              ) : (
                <button
                  onClick={() => onInvite(c.email)}
                  disabled={inviting}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] font-medium hover:bg-secondary disabled:opacity-50"
                >
                  <UserPlus size={13} />
                  Invite
                </button>
              )}
            </li>
          ))
        )}
      </ul>
    </section>
  )
}
