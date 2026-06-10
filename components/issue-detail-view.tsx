'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format } from 'date-fns'
import { toast } from 'sonner'
import { Bell, BellOff, ChevronRight, Plus, Trash2, X } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { RichTextEditor, RichTextDisplay, type MentionItem } from './rich-text-editor'
import { MemberAvatar } from '@/components/ui/member-avatar'
import { PropertySelect } from '@/components/ui/property-select'
import { DatePicker } from '@/components/ui/date-picker'
import {
  StatusIcon,
  PriorityIcon,
  issuePriorityKey,
} from '@/components/ui/work-item-icons'
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from '@/lib/work-items'

interface IssueDetail {
  id: number
  workspace_id: number
  seq: number | null
  title: string
  description: string | null
  status: string
  priority: number
  assignee_id: number | null
  reporter_id: number | null
  project_id: number | null
  milestone_id: number | null
  start_date: string | null
  due_date: string | null
  completed_at: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
  assignee_name: string | null
  assignee_email: string | null
  milestone_name: string | null
  project_name: string | null
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

interface Label {
  id: number
  name: string
  color: string
}

interface Member {
  user_id: number
  email: string
  name: string | null
  avatar_url?: string | null
}

interface Project {
  id: number
  name: string
}

interface Milestone {
  id: number
  name: string
  project_id: number | null
}

interface ActivityEvent {
  id: number
  action: string
  actor_name: string | null
  actor_email: string | null
  meta: Record<string, unknown> | null
  occurred_at: string
}

export function IssueDetailView({ issueId }: { issueId: number }) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const { data: ws } = useActiveWorkspace()

  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  const [composerKey, setComposerKey] = useState(0)
  const [commentDraft, setCommentDraft] = useState('')
  const [watching, setWatching] = useState(false)
  const [saving, setSaving] = useState(false)

  // Guard: an unparseable id (e.g. /dashboard/issues/new before that page
  // existed) used to spam the API with /api/issues/NaN. Bail out cleanly.
  const validId = Number.isFinite(issueId) && issueId > 0

  const issue = useQuery({
    queryKey: ['issue', issueId],
    enabled: validId,
    retry: false,
    queryFn: async (): Promise<IssueDetail> => {
      const res = await fetch(`/api/issues/${issueId}`)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  const comments = useQuery({
    queryKey: ['issue-comments', issueId],
    enabled: validId,
    retry: false,
    queryFn: async (): Promise<Comment[]> => {
      const res = await fetch(`/api/issues/${issueId}/comments`)
      if (!res.ok) return []
      return res.json()
    },
  })

  const labels = useQuery({
    queryKey: ['issue-labels', issueId, ws?.slug],
    enabled: !!ws && validId,
    retry: false,
    queryFn: async (): Promise<Label[]> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/issues/${issueId}/labels`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })

  const wsLabels = useQuery({
    queryKey: ['ws-labels', ws?.slug],
    enabled: !!ws,
    queryFn: async (): Promise<Label[]> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/labels`)
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

  const milestones = useQuery({
    queryKey: ['ws-milestones', ws?.slug],
    enabled: !!ws,
    queryFn: async (): Promise<Milestone[]> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/milestones`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })

  const events = useQuery({
    queryKey: ['issue-events', issueId, ws?.slug],
    enabled: !!ws,
    queryFn: async (): Promise<ActivityEvent[]> => {
      const res = await fetch(
        `/api/workspaces/${ws!.slug}/activity?entity_type=issue&limit=50`
      )
      if (!res.ok) return []
      const j = await res.json()
      return (j.data as Array<ActivityEvent & { entity_id: number }>).filter(
        (e) => e.entity_id === issueId
      )
    },
  })

  // Quiet patch used by autosave + property pickers (the UI itself is the
  // feedback); errors always toast.
  const patchIssue = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await fetch(`/api/issues/${issueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'failed')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] })
      queryClient.invalidateQueries({ queryKey: ['issue-events', issueId] })
      queryClient.invalidateQueries({ queryKey: ['ws-issues'] })
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setSaving(false),
  })

  /* --------- description autosave (debounced + on blur) ---------- */
  const descRef = useRef<string | null>(null) // latest html in the editor
  const savedDescRef = useRef<string | null>(null) // last persisted html
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushDescription = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (descRef.current !== null && descRef.current !== savedDescRef.current) {
      savedDescRef.current = descRef.current
      setSaving(true)
      patchIssue.mutate({ description: descRef.current })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onDescriptionChange = useCallback(
    (html: string) => {
      descRef.current = html
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(flushDescription, 1200)
    },
    [flushDescription]
  )

  // Flush pending edits when leaving the page.
  useEffect(() => () => flushDescription(), [flushDescription])

  const createComment = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(`/api/issues/${issueId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      setCommentDraft('')
      setComposerKey((k) => k + 1) // reset the editor
      queryClient.invalidateQueries({ queryKey: ['issue-comments', issueId] })
      queryClient.invalidateQueries({ queryKey: ['issue-events', issueId] })
    },
    onError: () => toast.error('Failed to post comment'),
  })

  const attachLabel = useMutation({
    mutationFn: async (labelId: number) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/issues/${issueId}/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label_id: labelId }),
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue-labels', issueId] })
      queryClient.invalidateQueries({ queryKey: ['issue-events', issueId] })
    },
    onError: () => toast.error('Could not update labels'),
  })

  const detachLabel = useMutation({
    mutationFn: async (labelId: number) => {
      const res = await fetch(
        `/api/workspaces/${ws!.slug}/issues/${issueId}/labels/${labelId}`,
        { method: 'DELETE' }
      )
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue-labels', issueId] })
      queryClient.invalidateQueries({ queryKey: ['issue-events', issueId] })
    },
    onError: () => toast.error('Could not update labels'),
  })

  const watch = useMutation({
    mutationFn: async (start: boolean) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/issues/${issueId}/watch`, {
        method: start ? 'POST' : 'DELETE',
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: (_d, start) => {
      setWatching(start)
      toast.success(start ? 'Subscribed to issue' : 'Unsubscribed')
      queryClient.invalidateQueries({ queryKey: ['issue-events', issueId] })
    },
    onError: () => toast.error('Could not update subscription'),
  })

  const deleteIssue = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${issueId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      toast.success('Issue deleted')
      window.location.href = '/dashboard/issues'
    },
    onError: () => toast.error('Could not delete issue'),
  })

  /* ------------------------------ render ------------------------------- */

  if (issue.isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-10">
        <div className="h-8 w-2/3 animate-pulse rounded bg-secondary/50" />
        <div className="h-4 w-full animate-pulse rounded bg-secondary/40" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-secondary/40" />
      </div>
    )
  }
  if (!issue.data) {
    return (
      <div className="p-8">
        <Link href="/dashboard/issues" className="text-xs text-muted-foreground hover:underline">
          ← Back to issues
        </Link>
        <p className="mt-4 text-sm">Issue not found.</p>
      </div>
    )
  }

  const data = issue.data
  const issueIdLabel = data.seq != null && ws ? `${ws.key}-${data.seq}` : `#${data.id}`
  const issueLabelIds = new Set((labels.data ?? []).map((l) => l.id))
  const availableLabels = (wsLabels.data ?? []).filter((l) => !issueLabelIds.has(l.id))
  const mentionItems: MentionItem[] = (members.data ?? []).map((m) => ({
    id: m.user_id,
    label: m.name ?? m.email,
    avatarUrl: m.avatar_url,
  }))

  function commitTitle() {
    const next = titleDraft?.trim()
    if (next && next !== data.title) {
      setSaving(true)
      patchIssue.mutate({ title: next })
    }
    setTitleDraft(null)
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Breadcrumb header */}
      <header className="sticky top-0 z-20 flex h-11 shrink-0 items-center gap-1.5 border-b border-border bg-background/80 px-4 text-[13px] backdrop-blur">
        <Link
          href="/dashboard/issues"
          prefetch={false}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Issues
        </Link>
        <ChevronRight size={13} className="text-muted-foreground/50" />
        <span className="font-mono text-xs text-muted-foreground">{issueIdLabel}</span>
        <span className="max-w-[28ch] truncate font-medium">{data.title}</span>
        <span className="ml-2 text-[11px] text-muted-foreground/70 transition-opacity">
          {saving ? 'Saving…' : ''}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => watch.mutate(!watching)}
            title={watching ? 'Unsubscribe' : 'Subscribe'}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {watching ? <BellOff size={15} /> : <Bell size={15} />}
          </button>
          <button
            onClick={async () => {
              if (
                !(await confirm({
                  title: `Delete ${issueIdLabel}?`,
                  description: 'This cannot be undone.',
                  destructive: true,
                  confirmLabel: 'Delete',
                }))
              )
                return
              deleteIssue.mutate()
            }}
            title="Delete issue"
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
            {/* Title — always editable, saves on blur/Enter */}
            <textarea
              rows={1}
              value={titleDraft ?? data.title}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  ;(e.target as HTMLTextAreaElement).blur()
                }
              }}
              maxLength={200}
              placeholder="Issue title"
              className="mb-3 w-full resize-none overflow-hidden bg-transparent text-[26px] font-semibold leading-snug tracking-tight outline-none placeholder:text-muted-foreground/50"
              ref={(el) => {
                if (el) {
                  el.style.height = 'auto'
                  el.style.height = `${el.scrollHeight}px`
                }
              }}
            />

            {/* Description — seamless TipTap, editable by default */}
            <RichTextEditor
              key={`desc-${data.id}`}
              content={data.description ?? ''}
              onChange={onDescriptionChange}
              onBlur={flushDescription}
              placeholder="Add description… type @ to mention someone"
              variant="seamless"
              mentionItems={mentionItems}
              minHeight="120px"
              onImageUpload={async (file) => {
                const fd = new FormData()
                fd.append('file', file)
                const res = await fetch('/api/upload', { method: 'POST', body: fd })
                if (!res.ok) throw new Error('upload failed')
                const j = await res.json()
                return j.url
              }}
            />

            {/* Activity + comments */}
            <section className="mt-12">
              <div className="mb-4 flex items-center gap-3">
                <h2 className="text-sm font-medium">Activity</h2>
                <div className="h-px flex-1 bg-border" />
              </div>

              {/* compact event feed */}
              {events.data?.length ? (
                <ul className="mb-6 space-y-2.5">
                  {events.data.slice(0, 10).map((e) => (
                    <li key={e.id} className="flex items-center gap-2.5 text-xs text-muted-foreground">
                      <span className="size-1.5 shrink-0 rounded-full bg-border" />
                      <span className="font-medium text-foreground/80">
                        {e.actor_name ?? e.actor_email ?? 'system'}
                      </span>
                      <span className="truncate">{e.action.replaceAll('_', ' ')}</span>
                      <span className="ml-auto shrink-0 text-[11px]" suppressHydrationWarning>
                        {formatDistanceToNow(new Date(e.occurred_at), { addSuffix: true })}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

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
                  key={`composer-${composerKey}`}
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
              value={data.status}
              searchPlaceholder="Change status…"
              options={ISSUE_STATUSES.map((s) => ({
                value: s.value,
                label: s.label,
                icon: <StatusIcon status={s.value} />,
              }))}
              onChange={(v) => patchIssue.mutate({ status: v })}
            />
            <PropertySelect
              value={String(data.priority)}
              searchPlaceholder="Change priority…"
              options={ISSUE_PRIORITIES.map((p) => ({
                value: String(p.value),
                label: p.label,
                icon: <PriorityIcon priority={issuePriorityKey(p.value)} />,
              }))}
              onChange={(v) => patchIssue.mutate({ priority: parseInt(v) })}
            />
            <PropertySelect
              value={data.assignee_id ? String(data.assignee_id) : ''}
              placeholder="Assignee"
              searchPlaceholder="Assign to…"
              options={[
                { value: '', label: 'Unassigned' },
                ...(members.data ?? []).map((m) => ({
                  value: String(m.user_id),
                  label: m.name ?? m.email,
                  icon: (
                    <MemberAvatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={16} />
                  ),
                })),
              ]}
              onChange={(v) => patchIssue.mutate({ assignee_id: v ? parseInt(v) : null })}
            />

            <div className="my-4 h-px bg-border" />
            <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">Labels</p>
            <div className="flex flex-wrap items-center gap-1.5 px-2">
              {(labels.data ?? []).map((l) => (
                <span
                  key={l.id}
                  className="group inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px]"
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: l.color }} />
                  {l.name}
                  <button
                    onClick={() => detachLabel.mutate(l.id)}
                    className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                    title="Remove label"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              {availableLabels.length > 0 ? (
                <PropertySelect
                  value=""
                  placeholder="Add label"
                  searchPlaceholder="Add label…"
                  buttonClassName="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  options={availableLabels.map((l) => ({
                    value: String(l.id),
                    label: l.name,
                    icon: (
                      <span className="size-2 rounded-full" style={{ backgroundColor: l.color }} />
                    ),
                  }))}
                  onChange={(v) => {
                    if (v) attachLabel.mutate(parseInt(v))
                  }}
                />
              ) : null}
              {!labels.data?.length && availableLabels.length === 0 ? (
                <span className="text-[11px] text-muted-foreground">No labels</span>
              ) : null}
            </div>

            <div className="my-4 h-px bg-border" />
            <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">Project</p>
            <PropertySelect
              value={data.project_id ? String(data.project_id) : ''}
              placeholder="Add to project"
              searchPlaceholder="Move to project…"
              options={[
                { value: '', label: 'No project' },
                ...(projects.data ?? []).map((p) => ({ value: String(p.id), label: p.name })),
              ]}
              onChange={(v) => patchIssue.mutate({ project_id: v ? parseInt(v) : null })}
            />
            <PropertySelect
              value={data.milestone_id ? String(data.milestone_id) : ''}
              placeholder="Add to milestone"
              searchPlaceholder="Set milestone…"
              options={[
                { value: '', label: 'No milestone' },
                ...(milestones.data ?? []).map((m) => ({ value: String(m.id), label: m.name })),
              ]}
              onChange={(v) => patchIssue.mutate({ milestone_id: v ? parseInt(v) : null })}
            />

            <div className="my-4 h-px bg-border" />
            <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">Due date</p>
            <DatePicker
              variant="inline"
              value={data.due_date ?? null}
              onChange={(v) => patchIssue.mutate({ due_date: v })}
              placeholder="Set due date"
            />

            <div className="my-4 h-px bg-border" />
            <ul className="space-y-1.5 px-2 text-[11px] text-muted-foreground">
              <li className="flex justify-between">
                <span>Created</span>
                <span suppressHydrationWarning>
                  {format(new Date(data.created_at), 'MMM d, yyyy')}
                </span>
              </li>
              <li className="flex justify-between">
                <span>Updated</span>
                <span suppressHydrationWarning>
                  {formatDistanceToNow(new Date(data.updated_at), { addSuffix: true })}
                </span>
              </li>
              {data.completed_at ? (
                <li className="flex justify-between">
                  <span>Completed</span>
                  <span suppressHydrationWarning>
                    {format(new Date(data.completed_at), 'MMM d, yyyy')}
                  </span>
                </li>
              ) : null}
            </ul>
          </div>
        </aside>
      </div>

      {/* reserved icons */}
      <span className="hidden">
        <Plus />
      </span>
    </div>
  )
}
