'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { CornerDownRight, Edit3, MessageSquare, Reply, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { uploadFile } from '@/lib/upload'
import { RichTextDisplay, RichTextEditor } from './rich-text-editor'
import type { MentionItem } from './rich-text-editor'
import { MemberAvatar } from '@/components/ui/member-avatar'
import { useConfirm } from '@/components/ui/confirm-dialog'

export interface CommentItem {
  id: number
  user_id: number | null
  content: string
  created_at: string
  edited_at: string | null
  author_name: string | null
  author_email: string | null
  author_avatar: string | null
  parent_comment_id: number | null
}

interface CommentSectionProps {
  /** URL for GET + POST (fetches list and creates new root comments) */
  commentsUrl: string
  /** Workspace slug — used for PATCH /api/workspaces/{ws}/comments/{id} */
  wsSlug: string
  /** TanStack Query key; invalidated after any mutation */
  queryKey: unknown[]
  /** TipTap @mention suggestions */
  mentionItems?: MentionItem[]
}

export function CommentSection({
  commentsUrl,
  wsSlug,
  queryKey,
  mentionItems = [],
}: CommentSectionProps) {
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

  const comments = useQuery({
    queryKey,
    queryFn: async (): Promise<CommentItem[]> => {
      const res = await fetch(commentsUrl)
      if (!res.ok) return []
      const j = await res.json()
      // Some endpoints return array directly, others wrap in { data }
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
      queryClient.invalidateQueries({ queryKey })
    },
    onError: () => toast.error('Failed to post comment'),
  })

  // Build a tree: top-level first, then replies grouped under their parent
  const allComments = comments.data ?? []
  const topLevel = allComments.filter((c) => !c.parent_comment_id)
  const repliesFor = (parentId: number) =>
    allComments.filter((c) => c.parent_comment_id === parentId)

  const currentUserId = me.data?.id ?? null

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <MessageSquare size={15} className="text-muted-foreground" />
        <span className="text-sm font-medium">
          {allComments.length > 0 ? `${allComments.length} comment${allComments.length > 1 ? 's' : ''}` : 'Comments'}
        </span>
      </div>

      {topLevel.length > 0 ? (
        <div className="mb-6 space-y-1">
          {topLevel.map((c) => (
            <CommentThread
              key={c.id}
              comment={c}
              replies={repliesFor(c.id)}
              currentUserId={currentUserId}
              wsSlug={wsSlug}
              commentsUrl={commentsUrl}
              queryKey={queryKey}
              mentionItems={mentionItems}
              confirm={confirm}
            />
          ))}
        </div>
      ) : null}

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
          onFileUpload={uploadFile}
        />
        <div className="flex items-center justify-end border-t border-border px-3 py-2">
          <button
            onClick={() => {
              if (draft.replace(/<[^>]*>/g, '').trim()) createRoot.mutate(draft)
            }}
            disabled={createRoot.isPending || !draft.replace(/<[^>]*>/g, '').trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {createRoot.isPending ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </div>
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
  const [replyOpen, setReplyOpen] = useState(false)

  return (
    <div className="rounded-lg border border-border bg-card/30">
      <CommentRow
        comment={comment}
        currentUserId={currentUserId}
        wsSlug={wsSlug}
        queryKey={queryKey}
        mentionItems={mentionItems}
        confirm={confirm}
        onReplyClick={() => setReplyOpen((v) => !v)}
        showReplyButton
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

      {replyOpen ? (
        <ReplyComposer
          parentCommentId={comment.id}
          commentsUrl={commentsUrl}
          queryKey={queryKey}
          mentionItems={mentionItems}
          onClose={() => setReplyOpen(false)}
        />
      ) : null}
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
  onReplyClick,
  showReplyButton = false,
  isReply = false,
}: {
  comment: CommentItem
  currentUserId: number | null
  wsSlug: string
  queryKey: unknown[]
  mentionItems: MentionItem[]
  confirm: ReturnType<typeof useConfirm>['confirm']
  onReplyClick?: () => void
  showReplyButton?: boolean
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
        {/* Indent indicator for replies */}
        {isReply ? (
          <CornerDownRight size={13} className="mt-1.5 shrink-0 text-muted-foreground/40" />
        ) : null}

        <MemberAvatar
          name={comment.author_name}
          email={comment.author_email}
          avatarUrl={comment.author_avatar}
          size={26}
        />

        <div className="min-w-0 flex-1">
          {/* Header */}
          <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[13px] font-medium">
              {comment.author_name ?? comment.author_email ?? 'Unknown'}
            </span>
            <span
              className="text-[11px] text-muted-foreground"
              suppressHydrationWarning
              title={new Date(comment.created_at).toLocaleString()}
            >
              {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
            </span>
            {comment.edited_at ? (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                edited
              </span>
            ) : null}
          </div>

          {/* Content or editor */}
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
                onFileUpload={uploadFile}
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
                  disabled={
                    editMutation.isPending || !editDraft.replace(/<[^>]*>/g, '').trim()
                  }
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

          {/* Action bar */}
          {!editing ? (
            <div className="mt-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              {showReplyButton && !isReply ? (
                <button
                  onClick={onReplyClick}
                  className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <Reply size={11} />
                  Reply
                </button>
              ) : null}
              {isOwn ? (
                <>
                  <button
                    onClick={startEdit}
                    className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <Edit3 size={11} />
                    Edit
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending}
                    className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-50"
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
  onClose,
}: {
  parentCommentId: number
  commentsUrl: string
  queryKey: unknown[]
  mentionItems: MentionItem[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [editorKey, setEditorKey] = useState(0)

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
      queryClient.invalidateQueries({ queryKey })
      onClose()
    },
    onError: () => toast.error('Failed to post reply'),
  })

  return (
    <div className="border-t border-border/60 bg-secondary/5 px-3 pb-3 pt-2">
      <div className="flex items-start gap-2">
        <CornerDownRight size={13} className="mt-2.5 shrink-0 text-muted-foreground/40" />
        <div className="flex-1 rounded-lg border border-border bg-card/40 focus-within:border-ring/50">
          <RichTextEditor
            key={`reply-${parentCommentId}-${editorKey}`}
            content=""
            onChange={setDraft}
            placeholder="Write a reply… type / to format, @ to mention"
            variant="bordered"
            hideToolbar
            mentionItems={mentionItems}
            minHeight="56px"
            onFileUpload={uploadFile}
          />
          <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
            <button
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
              title="Cancel reply"
            >
              <X size={13} />
            </button>
            <button
              onClick={() => {
                if (draft.replace(/<[^>]*>/g, '').trim()) reply.mutate(draft)
              }}
              disabled={reply.isPending || !draft.replace(/<[^>]*>/g, '').trim()}
              className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {reply.isPending ? 'Replying…' : 'Reply'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
