'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArchiveX,
  Check,
  Inbox as InboxIcon,
  AtSign,
  UserPlus,
  Users,
  MessageSquare,
  Building2,
  Crown,
  CircleCheck,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import { issueStatusLabel, projectStatusLabel } from '@/lib/work-items'

// Notifications can be about issues or projects — resolve whichever vocabulary matches.
function statusName(value: unknown): string {
  const v = String(value ?? '')
  const asIssue = issueStatusLabel(v)
  return asIssue !== v ? asIssue : projectStatusLabel(v)
}
import { IssueDetailView } from './issue-detail-view'
import { ProjectDetailView } from './project-detail-view'
import { MilestoneDetailView } from './milestone-detail-view'

// Comment excerpts arrive as raw TipTap HTML — render them as plain text.
function stripHtml(html: string, max = 90): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/<[^>]*$/, ' ') // excerpt may be truncated mid-tag
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

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
  invitation: <UserPlus size={15} className="text-muted-foreground" />,
  assigned: <Users size={15} className="text-muted-foreground" />,
  unassigned: <Users size={15} className="text-muted-foreground" />,
  status_changed: <CircleCheck size={15} className="text-muted-foreground" />,
  commented: <MessageSquare size={15} className="text-muted-foreground" />,
  mention: <AtSign size={15} className="text-muted-foreground" />,
  member_added: <Users size={15} className="text-muted-foreground" />,
  member_removed: <Users size={15} className="text-muted-foreground" />,
  ownership_transferred: <Crown size={15} className="text-muted-foreground" />,
}

type InboxTab = 'all' | 'unread' | 'archived'

export function InboxView() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<InboxTab>('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['inbox', tab],
    queryFn: () => {
      const params = new URLSearchParams()
      if (tab === 'unread') params.set('unread', 'true')
      if (tab === 'archived') params.set('archived_only', 'true')
      params.set('limit', '100')
      return fetch(`/api/me/inbox?${params}`).then((r) => {
        if (!r.ok) throw new Error('failed')
        return r.json() as Promise<InboxPage>
      })
    },
    refetchOnWindowFocus: true,
  })

  const selectedMessage = data?.data.find((m) => m.id === selectedId) ?? null

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

  const unarchive = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await fetch('/api/me/inbox/unarchive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox'] })
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

  function handleSelect(m: InboxMessage) {
    setSelectedId(m.id)
    if (!m.read_at) {
      markRead.mutate({ ids: [m.id] })
    }
  }

  return (
    <div className="flex h-[calc(100vh-0px)] overflow-hidden">
      {/* Left: message list */}
      <div className={`flex flex-col border-r border-border ${selectedMessage ? 'hidden md:flex md:w-80 lg:w-96' : 'w-full md:w-80 lg:w-96'}`}>
        <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2.5 border-b border-border bg-background/80 px-4 backdrop-blur">
          <h1 className="text-[15px] font-semibold">Inbox</h1>
          {(data?.unread_count ?? 0) > 0 && tab !== 'archived' ? (
            <span className="flex items-center justify-center rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium tabular-nums text-foreground/70 ring-1 ring-border/60">{data?.unread_count}</span>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            {(['all', 'unread', 'archived'] as InboxTab[]).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setSelectedId(null) }}
                className={`rounded-md px-2.5 py-1 text-[13px] capitalize transition-colors ${
                  tab === t ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t === 'all' ? 'All' : t === 'unread' ? 'Unread' : 'Archived'}
              </button>
            ))}
            {(data?.unread_count ?? 0) > 0 && tab !== 'archived' ? (
              <button
                onClick={() => markRead.mutate({ all: true })}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
                title="Mark all read"
              >
                <Check size={14} />
              </button>
            ) : null}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="px-6 py-4 text-sm text-muted-foreground">Loading…</p>
          ) : !data?.data.length ? (
            <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
              <InboxIcon size={28} className="mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {tab === 'unread' ? 'No unread notifications' : tab === 'archived' ? 'No archived notifications' : 'No notifications'}
              </p>
            </div>
          ) : (
            <ul>
              {data.data.map((m) => (
                <li
                  key={m.id}
                  onClick={() => handleSelect(m)}
                  className={`group flex cursor-pointer items-start gap-3 px-4 py-2.5 transition-colors hover:bg-secondary/40 ${
                    m.id === selectedId ? 'bg-secondary/60' : ''
                  } ${m.read_at ? 'opacity-60' : ''}`}
                >
                  <span className="flex w-3 shrink-0 items-center justify-center pt-1.5">
                    {!m.read_at ? <span className="size-1.5 rounded-full bg-primary" /> : null}
                  </span>
                  <div className="mt-0.5 shrink-0">{ICONS[m.type] ?? <Building2 size={15} className="text-muted-foreground" />}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-snug">{renderMessage(m)}</p>
                    {m.type === 'invitation' && typeof m.payload.invitation_id === 'number' ? (
                      <InvitationActions
                        invitationId={m.payload.invitation_id}
                        onAccept={accept.mutate}
                      />
                    ) : null}
                    <p className="mt-0.5 text-xs text-muted-foreground" suppressHydrationWarning>
                      {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  <div
                    className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!m.read_at && tab !== 'archived' ? (
                      <button
                        onClick={() => markRead.mutate({ ids: [m.id] })}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
                        title="Mark as read"
                      >
                        <Check size={14} />
                      </button>
                    ) : null}
                    {tab === 'archived' ? (
                      <button
                        onClick={() => {
                          if (m.id === selectedId) setSelectedId(null)
                          unarchive.mutate([m.id])
                        }}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
                        title="Unarchive"
                      >
                        <ArchiveX size={14} />
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          if (m.id === selectedId) setSelectedId(null)
                          archive.mutate([m.id])
                        }}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
                        title="Archive"
                      >
                        <Archive size={14} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Right: detail pane */}
      {selectedMessage ? (
        <div className="relative flex flex-1 flex-col overflow-hidden">
          <button
            onClick={() => setSelectedId(null)}
            className="absolute right-3 top-3 z-20 rounded-md p-1.5 text-muted-foreground hover:bg-secondary md:hidden"
            title="Close"
          >
            <X size={16} />
          </button>
          {/* Close button for desktop too */}
          <button
            onClick={() => setSelectedId(null)}
            className="absolute right-3 top-3 z-20 hidden rounded-md p-1.5 text-muted-foreground hover:bg-secondary md:flex"
            title="Close"
          >
            <X size={16} />
          </button>
          <div className="flex-1 overflow-y-auto">
            {selectedMessage.entity_type === 'issue' && selectedMessage.entity_id ? (
              <IssueDetailView issueId={selectedMessage.entity_id} />
            ) : selectedMessage.entity_type === 'project' && selectedMessage.entity_id ? (
              <ProjectDetailView projectId={selectedMessage.entity_id} />
            ) : selectedMessage.entity_type === 'milestone' && selectedMessage.entity_id ? (
              <MilestoneDetailView milestoneId={selectedMessage.entity_id} />
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <InboxIcon size={28} className="mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No linked item for this notification.</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="hidden flex-1 flex-col items-center justify-center text-center md:flex">
          <InboxIcon size={32} className="mb-3 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Select a notification to view details</p>
        </div>
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
          <strong>{issueLabel}</strong> moved from {statusName(p.from)} to {statusName(p.to)}
        </>
      )
    case 'commented': {
      const excerpt = p.excerpt ? stripHtml(String(p.excerpt)) : ''
      return (
        <>
          New comment on <strong>{issueLabel}</strong>
          {excerpt ? <span className="text-muted-foreground"> — {excerpt}</span> : ''}
        </>
      )
    }
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
        className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-secondary"
      >
        Decline
      </button>
    </div>
  )
}
