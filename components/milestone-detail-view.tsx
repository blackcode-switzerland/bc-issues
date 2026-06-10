'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow, isPast, isToday } from 'date-fns'
import { toast } from 'sonner'
import { ChevronRight, Trash2 } from 'lucide-react'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { RichTextEditor, RichTextDisplay, type MentionItem } from './rich-text-editor'
import { DatePicker } from '@/components/ui/date-picker'
import { StatusIcon, ProgressRing } from '@/components/ui/work-item-icons'
import { MemberAvatar } from '@/components/ui/member-avatar'
import { PropertySelect } from '@/components/ui/property-select'

interface MilestoneDetail {
  id: number
  workspace_id: number
  project_id: number | null
  name: string
  description: string | null
  due_date: string | null
  status: string | null
  created_at: string | null
  updated_at: string | null
  project_name: string | null
  issue_count: number
  completed_issues: number
}

interface IssueRow {
  id: number
  seq: number | null
  title: string
  status: string
  due_date: string | null
  assignee_name: string | null
  assignee_email: string | null
  assignee_avatar: string | null
}

interface Comment {
  id: number
  user_id: number | null
  content: string
  created_at: string
  edited_at: string | null
  author_name: string | null
  author_email: string | null
}

interface Project {
  id: number
  name: string
}

interface Member {
  user_id: number
  email: string
  name: string | null
  avatar_url?: string | null
}

export function MilestoneDetailView({ milestoneId }: { milestoneId: number }) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const { data: ws } = useActiveWorkspace()
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [composerKey, setComposerKey] = useState(0)
  const descRef = useRef<string>('')

  const milestone = useQuery({
    queryKey: ['milestone', milestoneId, ws?.slug],
    enabled: !!ws,
    queryFn: async (): Promise<MilestoneDetail | null> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/milestones/${milestoneId}`)
      if (!res.ok) return null
      return res.json()
    },
  })

  const issues = useQuery({
    queryKey: ['milestone-issues', milestoneId, ws?.slug],
    enabled: !!ws,
    queryFn: async (): Promise<IssueRow[]> => {
      const res = await fetch(
        `/api/workspaces/${ws!.slug}/issues?milestone_id=${milestoneId}&limit=200`
      )
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })

  const comments = useQuery({
    queryKey: ['milestone-comments', milestoneId, ws?.slug],
    enabled: !!ws,
    queryFn: async (): Promise<Comment[]> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/milestones/${milestoneId}/comments`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })

  const projects = useQuery({
    queryKey: ['ws-projects', ws?.slug],
    enabled: !!ws,
    queryFn: async (): Promise<Project[]> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })

  const members = useQuery({
    queryKey: ['ws-members', ws?.slug],
    enabled: !!ws,
    queryFn: async (): Promise<Member[]> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/members`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })

  const patch = useMutation({
    mutationFn: async (input: Record<string, unknown>) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/milestones/${milestoneId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      toast.success('Milestone updated')
      queryClient.invalidateQueries({ queryKey: ['milestone', milestoneId] })
      queryClient.invalidateQueries({ queryKey: ['ws-milestones-listing'] })
    },
    onError: () => toast.error('Failed to update milestone'),
  })

  const createComment = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/milestones/${milestoneId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      setCommentDraft('')
      setComposerKey((k) => k + 1)
      toast.success('Comment added')
      queryClient.invalidateQueries({ queryKey: ['milestone-comments', milestoneId] })
    },
    onError: () => toast.error('Failed to add comment'),
  })

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/milestones/${milestoneId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      toast.success('Milestone deleted')
      window.location.href = '/dashboard/milestones'
    },
    onError: () => toast.error('Could not delete milestone'),
  })

  if (milestone.isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-10">
        <div className="h-8 w-2/3 animate-pulse rounded bg-secondary/50" />
        <div className="h-4 w-full animate-pulse rounded bg-secondary/40" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-secondary/40" />
      </div>
    )
  }
  if (!milestone.data) {
    return (
      <div className="p-8">
        <Link href="/dashboard/milestones" className="text-xs text-muted-foreground hover:underline">
          ← Back to milestones
        </Link>
        <p className="mt-4 text-sm">Milestone not found.</p>
      </div>
    )
  }

  const data = milestone.data
  const due = data.due_date ? new Date(data.due_date) : null
  const overdue = due ? isPast(due) && !isToday(due) && data.status !== 'completed' : false
  const total = data.issue_count
  const done = data.completed_issues
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  const mentionItems: MentionItem[] = (members.data ?? []).map((m) => ({
    id: m.user_id,
    label: m.name ?? m.email,
    avatarUrl: m.avatar_url,
  }))

  function commitName() {
    const next = nameDraft?.trim()
    if (next && next !== data.name) patch.mutate({ name: next })
    setNameDraft(null)
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Breadcrumb header */}
      <header className="sticky top-0 z-20 flex h-11 shrink-0 items-center gap-1.5 border-b border-border bg-background/80 px-4 text-[13px] backdrop-blur">
        <Link
          href="/dashboard/milestones"
          prefetch={false}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Milestones
        </Link>
        <ChevronRight size={13} className="text-muted-foreground/50" />
        <span className="max-w-[36ch] truncate font-medium">{data.name}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={async () => {
              if (
                !(await confirm({
                  title: `Delete milestone "${data.name}"?`,
                  description: 'This cannot be undone.',
                  destructive: true,
                  confirmLabel: 'Delete',
                }))
              )
                return
              remove.mutate()
            }}
            title="Delete milestone"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col xl:flex-row">
        {/* Document */}
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-3xl px-6 py-10 sm:px-10">
            {/* Title — seamless editable, saves on blur/Enter */}
            <textarea
              rows={1}
              value={nameDraft ?? data.name}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  ;(e.target as HTMLTextAreaElement).blur()
                }
              }}
              maxLength={120}
              placeholder="Milestone name"
              className="mb-2 w-full resize-none overflow-hidden bg-transparent text-[26px] font-semibold leading-snug tracking-tight outline-none placeholder:text-muted-foreground/50"
              ref={(el) => {
                if (el) {
                  el.style.height = 'auto'
                  el.style.height = `${el.scrollHeight}px`
                }
              }}
            />

            {/* Description — seamless TipTap, editable by default, autosaves on blur */}
            <div className="mb-6">
              <RichTextEditor
                key={`mdesc-${data.id}`}
                content={data.description ?? ''}
                onChange={(html) => {
                  descRef.current = html
                }}
                onBlur={() => {
                  const next = descRef.current
                  if (next !== (data.description ?? '')) patch.mutate({ description: next })
                }}
                placeholder="Add description… type @ to mention someone"
                variant="seamless"
                minHeight="100px"
                mentionItems={mentionItems}
                onImageUpload={async (file) => {
                  const fd = new FormData()
                  fd.append('file', file)
                  const res = await fetch('/api/upload', { method: 'POST', body: fd })
                  if (!res.ok) throw new Error('upload failed')
                  const j = await res.json()
                  return j.url
                }}
              />
            </div>

            {/* Progress summary */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ProgressRing pct={pct} size={16} />
              <span>
                {done} of {total} issues completed
              </span>
            </div>

            {/* Issues */}
            <section className="mt-10">
              <div className="mb-2 flex items-center gap-3">
                <h2 className="text-sm font-medium">
                  Issues{' '}
                  <span className="text-muted-foreground">({issues.data?.length ?? 0})</span>
                </h2>
                <div className="h-px flex-1 bg-border" />
              </div>
              {issues.data?.length ? (
                <ul>
                  {issues.data.map((i) => (
                    <li key={i.id}>
                      <Link
                        href={`/dashboard/issues/${i.id}`}
                        prefetch={false}
                        className="flex h-10 items-center gap-3 rounded-md px-0 transition-colors hover:bg-secondary/40"
                      >
                        <StatusIcon status={i.status} size={14} />
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {i.seq != null && ws ? `${ws.key}-${i.seq}` : `#${i.id}`}
                        </span>
                        <span className="flex-1 truncate text-[13px]">{i.title}</span>
                        {i.due_date ? (
                          <span className="shrink-0 text-[11px] text-muted-foreground" suppressHydrationWarning>
                            {format(new Date(i.due_date), 'MMM d')}
                          </span>
                        ) : null}
                        {i.assignee_name || i.assignee_email ? (
                          <MemberAvatar
                            name={i.assignee_name}
                            email={i.assignee_email}
                            avatarUrl={i.assignee_avatar}
                            size={18}
                          />
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-2 text-[13px] text-muted-foreground">
                  No issues in this milestone yet.
                </p>
              )}
            </section>

            {/* Discussion */}
            <section className="mt-12">
              <div className="mb-4 flex items-center gap-3">
                <h2 className="text-sm font-medium">
                  Discussion{' '}
                  <span className="text-muted-foreground">({comments.data?.length ?? 0})</span>
                </h2>
                <div className="h-px flex-1 bg-border" />
              </div>
              {comments.data?.length ? (
                <ul className="mb-6 space-y-4">
                  {comments.data.map((c) => (
                    <li key={c.id} className="rounded-lg border border-border bg-card/40 p-3.5">
                      <div className="mb-2 flex items-center gap-2">
                        <MemberAvatar name={c.author_name} email={c.author_email} size={20} />
                        <span className="text-[13px] font-medium">
                          {c.author_name ?? c.author_email}
                        </span>
                        <span className="text-[11px] text-muted-foreground" suppressHydrationWarning>
                          {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                          {c.edited_at ? ' · edited' : ''}
                        </span>
                      </div>
                      {c.content.includes('<') ? (
                        <RichTextDisplay content={c.content} />
                      ) : (
                        <pre className="whitespace-pre-wrap break-words font-sans text-sm">
                          {c.content}
                        </pre>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}

              {/* Composer */}
              <div className="rounded-lg border border-border bg-card/40 transition-colors focus-within:border-ring/60">
                <RichTextEditor
                  key={`mcomposer-${composerKey}`}
                  content=""
                  onChange={setCommentDraft}
                  placeholder="Leave a comment… type @ to mention"
                  variant="bordered"
                  hideToolbar
                  mentionItems={mentionItems}
                  minHeight="64px"
                />
                <div className="flex justify-end border-t border-border px-2.5 py-2">
                  <button
                    onClick={() => {
                      const text = commentDraft.replace(/<[^>]*>/g, '').trim()
                      if (text) createComment.mutate(commentDraft)
                    }}
                    disabled={
                      createComment.isPending ||
                      !commentDraft.replace(/<[^>]*>/g, '').trim()
                    }
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    Comment
                  </button>
                </div>
              </div>
            </section>
          </div>
        </main>

        {/* Properties sidebar */}
        <aside className="w-full shrink-0 border-t border-border xl:w-72 xl:border-l xl:border-t-0">
          <div className="sticky top-11 px-4 py-5">
            <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">Properties</p>

            <PropertySelect
              value={data.project_id ? String(data.project_id) : ''}
              placeholder="Add to project"
              searchPlaceholder="Move to project…"
              options={[
                { value: '', label: 'No project' },
                ...(projects.data ?? []).map((p) => ({ value: String(p.id), label: p.name })),
              ]}
              onChange={(v) => patch.mutate({ project_id: v ? parseInt(v) : null })}
            />

            <div className="my-4 h-px bg-border" />
            <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">Target date</p>
            <DatePicker
              variant="inline"
              value={data.due_date ?? null}
              onChange={(v) => patch.mutate({ due_date: v })}
              placeholder="Set target date"
            />
            {overdue ? (
              <p className="mt-1 px-2 text-[11px] text-destructive">Overdue</p>
            ) : null}

            <div className="my-4 h-px bg-border" />
            <ul className="space-y-1.5 px-2 text-[11px] text-muted-foreground">
              {data.created_at ? (
                <li className="flex justify-between">
                  <span>Created</span>
                  <span suppressHydrationWarning>
                    {format(new Date(data.created_at), 'MMM d, yyyy')}
                  </span>
                </li>
              ) : null}
              {data.updated_at ? (
                <li className="flex justify-between">
                  <span>Updated</span>
                  <span suppressHydrationWarning>
                    {formatDistanceToNow(new Date(data.updated_at), { addSuffix: true })}
                  </span>
                </li>
              ) : null}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  )
}
