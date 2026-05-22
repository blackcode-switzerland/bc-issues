'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  Check,
  Inbox as InboxIcon,
  AtSign,
  UserPlus,
  Users,
  Activity as ActivityIcon,
  MessageSquare,
  Building2,
  Crown,
  CircleCheck,
} from 'lucide-react'
import { toast } from 'sonner'

interface InboxMessage {
  id: number
  user_id: number
  workspace_id: number | null
  type: string
  entity_type: string | null
  entity_id: number | null
  actor_user_id: number | null
  payload: Record<string, unknown>
  read_at: string | null
  archived_at: string | null
  created_at: string
}

interface InboxPage {
  data: InboxMessage[]
  next_cursor: number | null
  unread_count: number
}

async function fetchInbox(unreadOnly: boolean): Promise<InboxPage> {
  const params = new URLSearchParams()
  if (unreadOnly) params.set('unread', 'true')
  params.set('limit', '100')
  const res = await fetch(`/api/me/inbox?${params}`)
  if (!res.ok) throw new Error('failed')
  return res.json()
}

const ICONS: Record<string, React.ReactNode> = {
  invitation: <UserPlus size={16} className="text-emerald-400" />,
  assigned: <Users size={16} className="text-blue-400" />,
  unassigned: <Users size={16} className="text-zinc-400" />,
  status_changed: <CircleCheck size={16} className="text-purple-400" />,
  commented: <MessageSquare size={16} className="text-amber-400" />,
  mention: <AtSign size={16} className="text-pink-400" />,
  member_added: <Users size={16} className="text-emerald-400" />,
  member_removed: <Users size={16} className="text-red-400" />,
  ownership_transferred: <Crown size={16} className="text-amber-400" />,
}

export function InboxView() {
  const queryClient = useQueryClient()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['inbox', unreadOnly],
    queryFn: () => fetchInbox(unreadOnly),
    refetchOnWindowFocus: true,
  })

  const markRead = useMutation({
    mutationFn: async (opts: { ids?: number[]; all?: boolean }) => {
      const res = await fetch('/api/me/inbox/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox'] })
      queryClient.invalidateQueries({ queryKey: ['inbox-unread'] })
    },
  })

  const archive = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await fetch('/api/me/inbox/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox'] })
      queryClient.invalidateQueries({ queryKey: ['inbox-unread'] })
    },
  })

  const accept = useMutation({
    mutationFn: async ({ token }: { token: string }) => {
      const res = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Joined workspace')
      queryClient.invalidateQueries()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="p-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data?.unread_count ?? 0} unread · {data?.data.length ?? 0} shown
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border bg-card/30 p-0.5">
            <button
              onClick={() => setUnreadOnly(false)}
              className={`rounded px-3 py-1 text-xs ${
                !unreadOnly ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setUnreadOnly(true)}
              className={`rounded px-3 py-1 text-xs ${
                unreadOnly ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
              }`}
            >
              Unread
            </button>
          </div>
          {(data?.unread_count ?? 0) > 0 ? (
            <button
              onClick={() => markRead.mutate({ all: true })}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-secondary"
            >
              <Check size={14} />
              Mark all read
            </button>
          ) : null}
        </div>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.data.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card/30 p-16 text-center">
          <InboxIcon size={32} className="mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {unreadOnly ? 'No unread messages.' : 'Your inbox is empty.'}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card/30">
          {data.data.map((m) => (
            <li
              key={m.id}
              className={`flex items-start gap-3 px-4 py-3 ${
                m.read_at ? 'opacity-60' : ''
              }`}
            >
              <div className="mt-0.5 shrink-0">{ICONS[m.type] ?? <Building2 size={16} />}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm">{renderMessage(m)}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground" suppressHydrationWarning>
                  {new Date(m.created_at).toLocaleString()}
                </p>
                {m.type === 'invitation' && typeof m.payload.invitation_id === 'number' ? (
                  <InvitationActions invitationId={m.payload.invitation_id} onAccept={accept.mutate} />
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {!m.read_at ? (
                  <button
                    onClick={() => markRead.mutate({ ids: [m.id] })}
                    className="rounded p-1 text-muted-foreground hover:bg-secondary"
                    title="Mark as read"
                  >
                    <Check size={14} />
                  </button>
                ) : null}
                <button
                  onClick={() => archive.mutate([m.id])}
                  className="rounded p-1 text-muted-foreground hover:bg-secondary"
                  title="Archive"
                >
                  <Archive size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function renderMessage(m: InboxMessage): React.ReactNode {
  const p = m.payload as Record<string, string | number | null>
  const wsName = (p.workspace_name as string) || ''
  const issueLabel = p.issue_seq ? `${p.workspace_key}-${p.issue_seq}` : `#${p.issue_id ?? ''}`
  switch (m.type) {
    case 'invitation':
      return <>You were invited to <strong>{wsName}</strong></>
    case 'assigned':
      return <>You were assigned <strong>{issueLabel}</strong> {p.issue_title ? `· ${p.issue_title}` : ''}</>
    case 'unassigned':
      return <>You were unassigned from <strong>{issueLabel}</strong> {p.issue_title ? `· ${p.issue_title}` : ''}</>
    case 'status_changed':
      return (
        <>
          <strong>{issueLabel}</strong> moved <span className="font-mono text-xs">{p.from}</span> →{' '}
          <span className="font-mono text-xs">{p.to}</span>
        </>
      )
    case 'commented':
      return (
        <>
          New comment on <strong>{issueLabel}</strong>{p.excerpt ? `: "${p.excerpt}"` : ''}
        </>
      )
    case 'mention':
      return <>You were mentioned in <strong>{issueLabel}</strong></>
    case 'member_added':
      return <>New member joined <strong>{wsName}</strong></>
    case 'member_removed':
      return <>You were removed from <strong>{wsName}</strong></>
    case 'ownership_transferred':
      return (
        <>
          Ownership of <strong>{wsName}</strong>{' '}
          {p.you_are === 'new_owner' ? 'was transferred to you' : 'was transferred away'}
        </>
      )
    case 'invitation_accepted':
      return <>{p.invitee_email} accepted your invitation to <strong>{wsName}</strong></>
    default:
      return <>{m.type} in {wsName}</>
  }
}

function InvitationActions({
  invitationId,
  onAccept,
}: {
  invitationId: number
  onAccept: (input: { token: string }) => void
}) {
  // We need the token. Fetch the pending invitations list (small).
  const { data } = useQuery({
    queryKey: ['pending-invitations'],
    queryFn: async () => {
      const res = await fetch('/api/me/pending-invitations')
      if (!res.ok) return { data: [] }
      return res.json()
    },
  })
  const inv = data?.data?.find((i: { id: number; token: string }) => i.id === invitationId)
  if (!inv) return null
  return (
    <div className="mt-2 flex items-center gap-2">
      <button
        onClick={() => onAccept({ token: inv.token })}
        className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        Accept
      </button>
      <button
        onClick={() =>
          fetch('/api/invitations/decline', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: inv.token }),
          })
        }
        className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-secondary"
      >
        Decline
      </button>
    </div>
  )
}

void ActivityIcon
