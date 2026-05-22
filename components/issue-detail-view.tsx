'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format } from 'date-fns'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Calendar,
  Check,
  Edit3,
  Eye,
  EyeOff,
  Plus,
  Send,
  Tag,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { LabelChip } from './listings/labels-pill'

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

const STATUSES = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'in_review', label: 'In review' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
]

const PRIORITIES = [
  { value: 1, label: 'Urgent', color: 'text-red-400' },
  { value: 2, label: 'High', color: 'text-amber-400' },
  { value: 3, label: 'Medium', color: 'text-blue-400' },
  { value: 4, label: 'Low', color: 'text-zinc-400' },
  { value: 5, label: 'None', color: 'text-zinc-500' },
]

export function IssueDetailView({ issueId }: { issueId: number }) {
  const queryClient = useQueryClient()
  const { data: ws } = useActiveWorkspace()
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [editingDescription, setEditingDescription] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const [newComment, setNewComment] = useState('')

  const issue = useQuery({
    queryKey: ['issue', issueId],
    queryFn: async (): Promise<IssueDetail> => {
      const res = await fetch(`/api/issues/${issueId}`)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  const comments = useQuery({
    queryKey: ['issue-comments', issueId],
    queryFn: async (): Promise<Comment[]> => {
      const res = await fetch(`/api/issues/${issueId}/comments`)
      if (!res.ok) return []
      return res.json()
    },
  })

  const labels = useQuery({
    queryKey: ['issue-labels', issueId, ws?.slug],
    enabled: !!ws,
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
  })

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
      setNewComment('')
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
  })

  const watch = useMutation({
    mutationFn: async (start: boolean) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/issues/${issueId}/watch`, {
        method: start ? 'POST' : 'DELETE',
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['issue-events', issueId] }),
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
  })

  useEffect(() => {
    if (issue.data && !editingTitle) setTitleDraft(issue.data.title)
  }, [issue.data, editingTitle])

  useEffect(() => {
    if (issue.data && !editingDescription) setDescDraft(issue.data.description ?? '')
  }, [issue.data, editingDescription])

  if (issue.isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>
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

  return (
    <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_280px]">
      <main>
        <Link
          href="/dashboard/issues"
          className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          prefetch={false}
        >
          <ArrowLeft size={12} />
          Back to issues
        </Link>

        <div className="mb-2 flex items-center gap-2">
          <span className="rounded bg-secondary px-2 py-0.5 font-mono text-xs text-muted-foreground">
            {issueIdLabel}
          </span>
          <span className="text-[11px] text-muted-foreground" suppressHydrationWarning>
            opened {formatDistanceToNow(new Date(data.created_at), { addSuffix: true })}
          </span>
        </div>

        {editingTitle ? (
          <div className="mb-4 flex gap-2">
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              maxLength={200}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-lg font-semibold outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={() => {
                if (titleDraft.trim()) {
                  patchIssue.mutate({ title: titleDraft.trim() }, { onSuccess: () => setEditingTitle(false) })
                }
              }}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              Save
            </button>
            <button
              onClick={() => setEditingTitle(false)}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <h1
            onDoubleClick={() => setEditingTitle(true)}
            className="mb-4 cursor-text text-2xl font-semibold leading-tight"
            title="Double-click to edit"
          >
            {data.title}
          </h1>
        )}

        <section className="mb-6 rounded-lg border border-border bg-card/30 p-4">
          <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
            <span>Description</span>
            {!editingDescription ? (
              <button
                onClick={() => setEditingDescription(true)}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <Edit3 size={11} />
                Edit
              </button>
            ) : null}
          </div>
          {editingDescription ? (
            <>
              <textarea
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                rows={6}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() =>
                    patchIssue.mutate(
                      { description: descDraft },
                      { onSuccess: () => setEditingDescription(false) }
                    )
                  }
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setEditingDescription(false)
                    setDescDraft(data.description ?? '')
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : data.description ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-sm">{data.description}</pre>
          ) : (
            <p className="text-sm italic text-muted-foreground">No description.</p>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium">
            Comments <span className="text-muted-foreground">({comments.data?.length ?? 0})</span>
          </h2>
          {comments.data?.length ? (
            <ul className="mb-4 space-y-3">
              {comments.data.map((c) => (
                <li key={c.id} className="rounded-lg border border-border bg-card/30 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <div className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
                      {(c.author_name ?? c.author_email ?? '?')[0].toUpperCase()}
                    </div>
                    <span className="text-xs font-medium">{c.author_name ?? c.author_email}</span>
                    <span className="text-[11px] text-muted-foreground" suppressHydrationWarning>
                      {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                      {c.edited_at ? ' · edited' : ''}
                    </span>
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm">{c.content}</pre>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm italic text-muted-foreground">No comments yet.</p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (newComment.trim()) createComment.mutate(newComment.trim())
            }}
            className="rounded-lg border border-border bg-card/30 p-3"
          >
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Write a comment…"
              rows={3}
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="mt-2 flex justify-end">
              <button
                type="submit"
                disabled={!newComment.trim() || createComment.isPending}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Send size={12} />
                Comment
              </button>
            </div>
          </form>
        </section>
      </main>

      <aside className="space-y-4">
        <Picker
          label="Status"
          value={data.status}
          options={STATUSES}
          onChange={(v) => patchIssue.mutate({ status: v })}
        />
        <Picker
          label="Priority"
          value={String(data.priority)}
          options={PRIORITIES.map((p) => ({ value: String(p.value), label: p.label }))}
          onChange={(v) => patchIssue.mutate({ priority: parseInt(v) })}
        />
        <Picker
          label="Assignee"
          value={data.assignee_id ? String(data.assignee_id) : ''}
          options={[
            { value: '', label: 'Unassigned' },
            ...(members.data ?? []).map((m) => ({
              value: String(m.user_id),
              label: m.name ?? m.email,
            })),
          ]}
          onChange={(v) => patchIssue.mutate({ assignee_id: v ? parseInt(v) : null })}
        />
        <Picker
          label="Project"
          value={data.project_id ? String(data.project_id) : ''}
          options={[
            { value: '', label: 'No project' },
            ...(projects.data ?? []).map((p) => ({ value: String(p.id), label: p.name })),
          ]}
          onChange={(v) => patchIssue.mutate({ project_id: v ? parseInt(v) : null })}
        />
        <Picker
          label="Milestone"
          value={data.milestone_id ? String(data.milestone_id) : ''}
          options={[
            { value: '', label: 'No milestone' },
            ...(milestones.data ?? []).map((m) => ({ value: String(m.id), label: m.name })),
          ]}
          onChange={(v) => patchIssue.mutate({ milestone_id: v ? parseInt(v) : null })}
        />

        <Section title="Labels">
          {labels.data?.length ? (
            <div className="mb-2 flex flex-wrap gap-1">
              {labels.data.map((l) => (
                <button
                  key={l.id}
                  onClick={() => detachLabel.mutate(l.id)}
                  title="Remove label"
                  className="group"
                >
                  <LabelChip label={l} />
                </button>
              ))}
            </div>
          ) : (
            <p className="mb-2 text-xs text-muted-foreground">No labels.</p>
          )}
          {availableLabels.length > 0 ? (
            <LabelAdder labels={availableLabels} onAdd={(id) => attachLabel.mutate(id)} />
          ) : null}
        </Section>

        <Section title="Dates">
          <ul className="space-y-1.5 text-xs">
            <li className="flex justify-between text-muted-foreground">
              <span>Created</span>
              <span suppressHydrationWarning>{format(new Date(data.created_at), 'MMM d, yyyy')}</span>
            </li>
            {data.due_date ? (
              <li className="flex justify-between text-muted-foreground">
                <span>Due</span>
                <span>{format(new Date(data.due_date), 'MMM d, yyyy')}</span>
              </li>
            ) : null}
            {data.completed_at ? (
              <li className="flex justify-between text-muted-foreground">
                <span>Completed</span>
                <span suppressHydrationWarning>
                  {format(new Date(data.completed_at), 'MMM d, yyyy')}
                </span>
              </li>
            ) : null}
          </ul>
        </Section>

        <button
          onClick={() => watch.mutate(true)}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-card/30 px-3 py-2 text-xs text-muted-foreground hover:bg-secondary"
        >
          <Eye size={12} />
          Watch
        </button>

        <button
          onClick={() => {
            if (confirm(`Delete ${issueIdLabel}? This cannot be undone.`)) {
              deleteIssue.mutate()
            }
          }}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive hover:bg-destructive/10"
        >
          <Trash2 size={12} />
          Delete issue
        </button>

        {events.data?.length ? (
          <Section title="Activity">
            <ul className="space-y-1.5 text-[11px] text-muted-foreground">
              {events.data.slice(0, 12).map((e) => (
                <li key={e.id} className="flex flex-col">
                  <span className="text-foreground">{e.actor_name ?? e.actor_email ?? 'system'}</span>
                  <span suppressHydrationWarning>
                    {e.action} — {formatDistanceToNow(new Date(e.occurred_at), { addSuffix: true })}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </aside>

      {/* unused icons reserved */}
      <span className="hidden">
        <User /> <Tag /> <Plus /> <X /> <Calendar /> <Check /> <EyeOff />
      </span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card/30 p-3">
      <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
}) {
  return (
    <Section title={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
      >
        {options.map((o) => (
          <option key={o.value || 'none'} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Section>
  )
}

function LabelAdder({
  labels,
  onAdd,
}: {
  labels: Label[]
  onAdd: (id: number) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary"
      >
        <Plus size={10} />
        Add label
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
          <ul className="max-h-48 overflow-y-auto py-1">
            {labels.map((l) => (
              <li key={l.id}>
                <button
                  onClick={() => {
                    onAdd(l.id)
                    setOpen(false)
                  }}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-secondary"
                >
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ backgroundColor: l.color }}
                  />
                  {l.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
