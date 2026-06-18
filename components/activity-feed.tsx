'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import {
  ArrowUp,
  CalendarDays,
  CornerDownRight,
  Edit3,
  Paperclip,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { format } from 'date-fns'
import type { MentionItem } from './rich-text-editor'
import { RichTextDisplay, RichTextEditor } from './rich-text-editor'
import { MemberAvatar } from '@/components/ui/member-avatar'
import {
  StatusIcon,
  PriorityIcon,
  issuePriorityKey,
  projectPriorityKey,
} from '@/components/ui/work-item-icons'
import { useConfirm } from '@/components/ui/confirm-dialog'
import type { CommentItem } from './comment-section'
import {
  issueStatusLabel,
  issuePriorityLabel,
  projectStatusLabel,
  projectPriorityLabel,
} from '@/lib/work-items'

interface ActivityEvent {
  id: number
  entity_id: number
  action: string
  actor_name: string | null
  actor_email: string | null
  meta: Record<string, unknown> | null
  occurred_at: string
}

interface Member {
  user_id: number
  name: string | null
  email: string
  avatar_url?: string | null
}

interface ActivityFeedProps {
  entityType: 'issue' | 'project' | 'task'
  entityId: number
  wsSlug: string
  commentsUrl: string
  commentsQueryKey: unknown[]
  mentionItems?: MentionItem[]
  members?: Member[]
}

type TimelineItem =
  | { kind: 'event'; event: ActivityEvent; ts: number }
  | { kind: 'comment'; comment: CommentItem; replies: CommentItem[]; ts: number }

const SKIP_ACTIONS = new Set(['commented', 'mentioned', 'updated'])

function findMember(id: number | null | undefined, members: Member[]): Member | null {
  if (!id) return null
  return members.find((m) => m.user_id === id) ?? null
}

function findMemberByEmail(email: string | null | undefined, members: Member[]): Member | null {
  if (!email) return null
  return members.find((m) => m.email === email) ?? null
}

function memberLabel(m: Member | null): string {
  if (!m) return 'someone'
  return m.name ?? m.email
}

function formatDate(d: string | null | undefined): string {
  if (!d) return 'none'
  try {
    return format(new Date(d), 'MMM d, yyyy')
  } catch {
    return d
  }
}

function describeAction(
  action: string,
  meta: Record<string, unknown> | null,
  entityType: string,
  members: Member[]
): React.ReactNode {
  switch (action) {
    case 'created':
      return `created this ${entityType}`

    case 'status_changed': {
      const from = meta?.from as string | undefined
      const to = meta?.to as string | undefined
      const fromLabel =
        entityType === 'project' ? projectStatusLabel(from ?? '') : issueStatusLabel(from ?? '')
      const toLabel =
        entityType === 'project' ? projectStatusLabel(to ?? '') : issueStatusLabel(to ?? '')
      return (
        <>
          {'moved from '}
          <span className="font-medium text-foreground/80">{fromLabel}</span>
          {' to '}
          <span className="font-medium text-foreground/80">{toLabel}</span>
        </>
      )
    }

    case 'priority_changed': {
      const from = meta?.from
      const to = meta?.to
      const isProject = entityType === 'project'
      const fromLabel = isProject
        ? projectPriorityLabel(String(from ?? ''))
        : issuePriorityLabel(Number(from ?? 0))
      const toLabel = isProject
        ? projectPriorityLabel(String(to ?? ''))
        : issuePriorityLabel(Number(to ?? 0))
      return (
        <>
          {'changed priority from '}
          <span className="font-medium text-foreground/80">{fromLabel}</span>
          {' to '}
          <span className="font-medium text-foreground/80">{toLabel}</span>
        </>
      )
    }

    case 'assigned': {
      const assigneeId = meta?.assignee_id as number | null | undefined
      const m = findMember(assigneeId, members)
      return (
        <span className="inline-flex items-center gap-1">
          {'assigned '}
          {m ? (
            <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
              <MemberAvatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={14} />
              {memberLabel(m)}
            </span>
          ) : (
            <span className="font-medium text-foreground/80">someone</span>
          )}
        </span>
      )
    }

    case 'unassigned': {
      const prevId = meta?.previous_assignee_id as number | null | undefined
      const m = findMember(prevId, members)
      return m ? (
        <span className="inline-flex items-center gap-1">
          {'removed '}
          <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
            <MemberAvatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={14} />
            {memberLabel(m)}
          </span>
          {' as assignee'}
        </span>
      ) : (
        'removed assignee'
      )
    }

    case 'labeled': {
      const name = meta?.label_name as string | undefined
      const color = meta?.label_color as string | undefined
      return (
        <span className="inline-flex items-center gap-1">
          {'added label '}
          <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
            {color ? (
              <span className="inline-block size-2 rounded-full" style={{ backgroundColor: color }} />
            ) : (
              <Tag size={11} />
            )}
            {name}
          </span>
        </span>
      )
    }

    case 'unlabeled': {
      const name = meta?.label_name as string | undefined
      const color = meta?.label_color as string | undefined
      return (
        <span className="inline-flex items-center gap-1">
          {'removed label '}
          <span className="inline-flex items-center gap-1 font-medium text-foreground/80 line-through opacity-70">
            {color ? (
              <span className="inline-block size-2 rounded-full opacity-60" style={{ backgroundColor: color }} />
            ) : null}
            {name}
          </span>
        </span>
      )
    }

    case 'due_date_changed': {
      const from = meta?.from as string | null | undefined
      const to = meta?.to as string | null | undefined
      return (
        <>
          {to ? (
            <>
              {'set due date to '}
              <span className="font-medium text-foreground/80">{formatDate(to)}</span>
            </>
          ) : (
            'removed due date'
          )}
          {from ? (
            <span className="text-muted-foreground/60">
              {' (was '}
              {formatDate(from)}
              {')'}
            </span>
          ) : null}
        </>
      )
    }

    case 'task_changed':
      return 'changed task'

    case 'project_changed':
      return 'changed project'

    case 'archived':
      return `archived this ${entityType}`

    case 'restored':
      return `restored this ${entityType}`

    case 'deleted':
      return `deleted this ${entityType}`

    default:
      return action.replaceAll('_', ' ')
  }
}

export function ActivityFeed({
  entityType,
  entityId,
  wsSlug,
  commentsUrl,
  commentsQueryKey,
  mentionItems = [],
  members = [],
}: ActivityFeedProps) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [composerKey, setComposerKey] = useState(0)
  const [draft, setDraft] = useState('')

  const me = useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<{ id: number }> => {
      const res = await fetch('/api/me')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    staleTime: 60_000,
  })

  const eventsQuery = useQuery({
    queryKey: ['activity', entityType, entityId, wsSlug],
    enabled: !!wsSlug,
    queryFn: async (): Promise<ActivityEvent[]> => {
      const res = await fetch(
        `/api/workspaces/${wsSlug}/activity?entity_type=${entityType}&limit=100`
      )
      if (!res.ok) return []
      const j = await res.json()
      return (j.data as ActivityEvent[]).filter((e) => e.entity_id === entityId)
    },
  })

  const commentsQuery = useQuery({
    queryKey: commentsQueryKey,
    queryFn: async (): Promise<CommentItem[]> => {
      const res = await fetch(commentsUrl)
      if (!res.ok) return []
      const j = await res.json()
      return Array.isArray(j) ? j : (j.data ?? [])
    },
  })

  const createRoot = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(commentsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      setDraft('')
      setComposerKey((k) => k + 1)
      queryClient.invalidateQueries({ queryKey: commentsQueryKey })
    },
    onError: () => toast.error('Failed to post comment'),
  })

  const currentUserId = me.data?.id ?? null
  const allComments = commentsQuery.data ?? []
  const topLevel = allComments.filter((c) => !c.parent_comment_id)
  const repliesFor = (parentId: number) => allComments.filter((c) => c.parent_comment_id === parentId)

  // Merge events + top-level comments into a single chronological timeline
  const timeline: TimelineItem[] = []

  for (const event of eventsQuery.data ?? []) {
    if (SKIP_ACTIONS.has(event.action)) continue
    timeline.push({ kind: 'event', event, ts: new Date(event.occurred_at).getTime() })
  }

  for (const comment of topLevel) {
    timeline.push({
      kind: 'comment',
      comment,
      replies: repliesFor(comment.id),
      ts: new Date(comment.created_at).getTime(),
    })
  }

  timeline.sort((a, b) => a.ts - b.ts)

  const loading = eventsQuery.isLoading || commentsQuery.isLoading

  return (
    <div>
      {loading ? (
        <div className="mb-6 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2.5">
              <span className="size-5 animate-pulse rounded-full bg-secondary/60" />
              <span className="h-3 w-56 animate-pulse rounded bg-secondary/40" />
            </div>
          ))}
        </div>
      ) : timeline.length === 0 ? (
        <p className="mb-6 text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <div className="mb-6 space-y-1.5">
          {timeline.map((item) => {
            if (item.kind === 'event') {
              return (
                <EventRow
                  key={`ev-${item.event.id}`}
                  event={item.event}
                  entityType={entityType}
                  members={members}
                />
              )
            }
            return (
              <CommentThread
                key={`cmt-${item.comment.id}`}
                comment={item.comment}
                replies={item.replies}
                currentUserId={currentUserId}
                wsSlug={wsSlug}
                commentsUrl={commentsUrl}
                queryKey={commentsQueryKey}
                mentionItems={mentionItems}
                confirm={confirm}
              />
            )
          })}
        </div>
      )}

      {/* Root composer */}
      <div className="rounded-lg border border-border bg-card/30 transition-colors focus-within:border-ring/50">
        <RichTextEditor
          key={`root-${composerKey}`}
          content=""
          onChange={setDraft}
          placeholder="Leave a comment… type / to format, @ to mention"
          variant="bordered"
          hideToolbar
          mentionItems={mentionItems}
          minHeight="72px"
          onFileUpload={async (file) => {
            const fd = new FormData()
            fd.append('file', file)
            const res = await fetch('/api/upload', { method: 'POST', body: fd })
            if (!res.ok) throw new Error('upload failed')
            const j = await res.json()
            return j.url
          }}
        />
        <div className="flex items-center justify-end border-t border-border px-3 py-2">
          <button
            onClick={() => {
              if (draft.replace(/<[^>]*>/g, '').trim()) createRoot.mutate(draft)
            }}
            disabled={createRoot.isPending || !draft.replace(/<[^>]*>/g, '').trim()}
            className="rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {createRoot.isPending ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </div>
    </div>
  )
}

function eventLeftIcon(
  action: string,
  meta: Record<string, unknown> | null,
  entityType: string,
  actorMember: Member | null,
  actorName: string | null,
  actorEmail: string | null
): React.ReactNode {
  switch (action) {
    case 'status_changed': {
      const to = meta?.to as string | undefined
      return (
        <span className="flex size-[20px] shrink-0 items-center justify-center">
          <StatusIcon status={to ?? ''} size={15} />
        </span>
      )
    }
    case 'priority_changed': {
      const to = meta?.to
      const isProject = entityType === 'project'
      const toKey = isProject
        ? projectPriorityKey(String(to ?? ''))
        : issuePriorityKey(Number(to ?? 0))
      return (
        <span className="flex size-[20px] shrink-0 items-center justify-center">
          <PriorityIcon priority={toKey} size={15} />
        </span>
      )
    }
    case 'due_date_changed':
      return (
        <span className="flex size-[20px] shrink-0 items-center justify-center">
          <CalendarDays size={14} className="text-muted-foreground/70" />
        </span>
      )
    default:
      // assigned, unassigned, created, labeled, archived, etc. → actor avatar
      return (
        <MemberAvatar
          name={actorMember?.name ?? actorName}
          email={actorEmail ?? ''}
          avatarUrl={actorMember?.avatar_url}
          size={20}
          className="shrink-0"
        />
      )
  }
}

function EventRow({
  event,
  entityType,
  members,
}: {
  event: ActivityEvent
  entityType: string
  members: Member[]
}) {
  const actorMember = findMemberByEmail(event.actor_email, members)
  const actorName = event.actor_name ?? event.actor_email ?? 'system'
  const text = describeAction(event.action, event.meta, entityType, members)
  const leftIcon = eventLeftIcon(
    event.action,
    event.meta,
    entityType,
    actorMember,
    event.actor_name,
    event.actor_email
  )

  return (
    <div className="flex items-center gap-2 py-0.5 text-sm text-muted-foreground">
      {leftIcon}
      <span className="inline-flex min-w-0 flex-1 flex-wrap items-center gap-x-1">
        <span className="font-medium text-foreground/80">{actorName}</span>
        <span className="inline-flex flex-wrap items-center gap-1">{text}</span>
      </span>
      <span className="ml-2 shrink-0 text-xs" suppressHydrationWarning>
        {formatDistanceToNow(new Date(event.occurred_at), { addSuffix: true })}
      </span>
    </div>
  )
}

function CommentThread({
  comment,
  replies,
  currentUserId,
  wsSlug,
  commentsUrl,
  queryKey,
  mentionItems,
  confirm,
}: {
  comment: CommentItem
  replies: CommentItem[]
  currentUserId: number | null
  wsSlug: string
  commentsUrl: string
  queryKey: unknown[]
  mentionItems: MentionItem[]
  confirm: ReturnType<typeof useConfirm>['confirm']
}) {
  return (
    <div className="my-3 rounded-lg border border-border bg-card/30">
      <CommentRow
        comment={comment}
        currentUserId={currentUserId}
        wsSlug={wsSlug}
        queryKey={queryKey}
        mentionItems={mentionItems}
        confirm={confirm}
      />

      {replies.length > 0 ? (
        <div className="border-t border-border/60">
          {replies.map((r, i) => (
            <div
              key={r.id}
              className={i < replies.length - 1 ? 'border-b border-border/40' : ''}
            >
              <CommentRow
                comment={r}
                currentUserId={currentUserId}
                wsSlug={wsSlug}
                queryKey={queryKey}
                mentionItems={mentionItems}
                confirm={confirm}
                isReply
              />
            </div>
          ))}
        </div>
      ) : null}

      {/* Always-visible reply bar */}
      <ReplyComposer
        parentCommentId={comment.id}
        commentsUrl={commentsUrl}
        queryKey={queryKey}
        mentionItems={mentionItems}
      />
    </div>
  )
}

function CommentRow({
  comment,
  currentUserId,
  wsSlug,
  queryKey,
  mentionItems,
  confirm,
  isReply = false,
}: {
  comment: CommentItem
  currentUserId: number | null
  wsSlug: string
  queryKey: unknown[]
  mentionItems: MentionItem[]
  confirm: ReturnType<typeof useConfirm>['confirm']
  isReply?: boolean
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState('')
  const [editKey, setEditKey] = useState(0)

  const isOwn = currentUserId !== null && comment.user_id === currentUserId

  const editMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(`/api/workspaces/${wsSlug}/comments/${comment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Failed to edit')
      }
    },
    onSuccess: () => {
      setEditing(false)
      queryClient.invalidateQueries({ queryKey })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${wsSlug}/comments/${comment.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Failed to delete')
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  })

  function startEdit() {
    setEditDraft(comment.content)
    setEditKey((k) => k + 1)
    setEditing(true)
  }

  function saveEdit() {
    const text = editDraft.replace(/<[^>]*>/g, '').trim()
    if (text) editMutation.mutate(editDraft)
  }

  async function handleDelete() {
    const ok = await confirm({
      title: 'Delete comment?',
      description: 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (ok) deleteMutation.mutate()
  }

  return (
    <div className={`group p-3.5 ${isReply ? 'bg-secondary/10' : ''}`}>
      <div className="flex gap-3">
        {isReply ? (
          <CornerDownRight size={13} className="mt-1.5 shrink-0 text-muted-foreground/40" />
        ) : null}

        <MemberAvatar
          name={comment.author_name}
          email={comment.author_email}
          avatarUrl={comment.author_avatar}
          size={28}
        />

        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium">
              {comment.author_name ?? comment.author_email ?? 'Unknown'}
            </span>
            <span
              className="text-xs text-muted-foreground"
              suppressHydrationWarning
              title={new Date(comment.created_at).toLocaleString()}
            >
              {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
            </span>
            {comment.edited_at ? (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                edited
              </span>
            ) : null}
          </div>

          {editing ? (
            <div className="rounded-lg border border-border bg-card/40 focus-within:border-ring/50">
              <RichTextEditor
                key={`edit-${comment.id}-${editKey}`}
                content={editDraft}
                onChange={setEditDraft}
                variant="bordered"
                hideToolbar
                mentionItems={mentionItems}
                minHeight="60px"
                onFileUpload={async (file) => {
                  const fd = new FormData()
                  fd.append('file', file)
                  const res = await fetch('/api/upload', { method: 'POST', body: fd })
                  if (!res.ok) throw new Error('upload failed')
                  const j = await res.json()
                  return j.url
                }}
              />
              <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  disabled={editMutation.isPending || !editDraft.replace(/<[^>]*>/g, '').trim()}
                  className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {editMutation.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <div className="prose-sm">
              {comment.content.includes('<') ? (
                <RichTextDisplay content={comment.content} />
              ) : (
                <pre className="whitespace-pre-wrap break-words font-sans text-sm text-foreground">
                  {comment.content}
                </pre>
              )}
            </div>
          )}

          {!editing ? (
            <div className="mt-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              {isOwn ? (
                <>
                  <button
                    onClick={startEdit}
                    className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <Edit3 size={11} />
                    Edit
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending}
                    className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2 size={11} />
                    Delete
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ReplyComposer({
  parentCommentId,
  commentsUrl,
  queryKey,
  mentionItems,
}: {
  parentCommentId: number
  commentsUrl: string
  queryKey: unknown[]
  mentionItems: MentionItem[]
}) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState('')
  const [editorKey, setEditorKey] = useState(0)

  const me = useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<{ id: number }> => {
      const res = await fetch('/api/me')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    staleTime: 60_000,
  })

  const reply = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(commentsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, parent_comment_id: parentCommentId }),
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      setDraft('')
      setEditorKey((k) => k + 1)
      setExpanded(false)
      queryClient.invalidateQueries({ queryKey })
    },
    onError: () => toast.error('Failed to post reply'),
  })

  // Collapsed — lightweight placeholder bar
  if (!expanded) {
    return (
      <div
        onClick={() => setExpanded(true)}
        className="flex cursor-text items-center gap-2.5 border-t border-border/60 px-3.5 py-2.5"
      >
        <MemberAvatar
          name={null}
          email={me.data ? `user-${me.data.id}` : ''}
          size={20}
        />
        <span className="flex-1 text-sm text-muted-foreground/50">Leave a reply…</span>
        <Paperclip size={14} className="shrink-0 text-muted-foreground/30" />
        <ArrowUp size={14} className="shrink-0 text-muted-foreground/30" />
      </div>
    )
  }

  // Expanded — full editor
  return (
    <div className="border-t border-border/60 bg-secondary/5 px-3.5 pb-3 pt-2.5">
      <div className="rounded-lg border border-border bg-card/40 focus-within:border-ring/50">
        <RichTextEditor
          key={`reply-${parentCommentId}-${editorKey}`}
          content=""
          onChange={setDraft}
          placeholder="Write a reply… type / to format, @ to mention"
          variant="bordered"
          hideToolbar
          mentionItems={mentionItems}
          minHeight="56px"
          onFileUpload={async (file) => {
            const fd = new FormData()
            fd.append('file', file)
            const res = await fetch('/api/upload', { method: 'POST', body: fd })
            if (!res.ok) throw new Error('upload failed')
            const j = await res.json()
            return j.url
          }}
        />
        <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
          <button
            onClick={() => {
              setExpanded(false)
              setDraft('')
              setEditorKey((k) => k + 1)
            }}
            className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
            title="Cancel"
          >
            <X size={13} />
          </button>
          <button
            onClick={() => {
              if (draft.replace(/<[^>]*>/g, '').trim()) reply.mutate(draft)
            }}
            disabled={reply.isPending || !draft.replace(/<[^>]*>/g, '').trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {reply.isPending ? 'Replying…' : 'Reply'}
          </button>
        </div>
      </div>
    </div>
  )
}
