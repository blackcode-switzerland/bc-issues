'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow, isPast, isToday } from 'date-fns'
import { toast } from 'sonner'
import { ArrowLeft, Edit3, Send, Trash2 } from 'lucide-react'
import { useActiveWorkspace } from './listings/use-active-workspace'

interface MilestoneDetail {
  id: number
  workspace_id: number
  project_id: number | null
  name: string
  description: string | null
  due_date: string | null
  status: string | null
  project_name: string | null
  issue_count: number
  completed_issues: number
}

interface IssueRow {
  id: number
  seq: number | null
  title: string
  status: string
  assignee_name: string | null
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

const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export function MilestoneDetailView({ milestoneId }: { milestoneId: number }) {
  const queryClient = useQueryClient()
  const { data: ws } = useActiveWorkspace()
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const [newComment, setNewComment] = useState('')

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
      setNewComment('')
      queryClient.invalidateQueries({ queryKey: ['milestone-comments', milestoneId] })
    },
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
  })

  useEffect(() => {
    if (milestone.data && !editingName) setNameDraft(milestone.data.name)
  }, [milestone.data, editingName])

  useEffect(() => {
    if (milestone.data && !editingDesc) setDescDraft(milestone.data.description ?? '')
  }, [milestone.data, editingDesc])

  if (milestone.isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>
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

  return (
    <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_280px]">
      <main>
        <Link
          href="/dashboard/milestones"
          className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          prefetch={false}
        >
          <ArrowLeft size={12} />
          Back to milestones
        </Link>

        {editingName ? (
          <div className="mb-4 flex gap-2">
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={120}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-lg font-semibold outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={() => patch.mutate({ name: nameDraft }, { onSuccess: () => setEditingName(false) })}
              className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
            >
              Save
            </button>
            <button
              onClick={() => setEditingName(false)}
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        ) : (
          <h1
            onDoubleClick={() => setEditingName(true)}
            className="mb-2 cursor-text text-2xl font-semibold"
          >
            {data.name}
          </h1>
        )}
        <p className="mb-4 text-xs text-muted-foreground">
          {data.project_name ?? 'Standalone'} · {total > 0 ? `${done}/${total} done (${pct}%)` : '0 issues'}
        </p>
        <div className="mb-6 h-1 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>

        <section className="mb-6 rounded-lg border border-border bg-card/30 p-4">
          <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
            <span>Description</span>
            {!editingDesc ? (
              <button
                onClick={() => setEditingDesc(true)}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <Edit3 size={11} />
                Edit
              </button>
            ) : null}
          </div>
          {editingDesc ? (
            <>
              <textarea
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() =>
                    patch.mutate(
                      { description: descDraft },
                      { onSuccess: () => setEditingDesc(false) }
                    )
                  }
                  className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingDesc(false)}
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

        <section className="mb-6">
          <h2 className="mb-3 text-sm font-medium">
            Issues <span className="text-muted-foreground">({issues.data?.length ?? 0})</span>
          </h2>
          {issues.data?.length ? (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card/30">
              {issues.data.map((i) => (
                <li key={i.id}>
                  <Link
                    href={`/dashboard/issues/${i.id}`}
                    prefetch={false}
                    className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-secondary/50"
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {i.seq != null && ws ? `${ws.key}-${i.seq}` : `#${i.id}`}
                    </span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                      {i.status.replace('_', ' ')}
                    </span>
                    <span className="flex-1 truncate">{i.title}</span>
                    {i.assignee_name ? (
                      <span className="text-[10px] text-muted-foreground">{i.assignee_name}</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm italic text-muted-foreground">No issues in this milestone yet.</p>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium">
            Discussion <span className="text-muted-foreground">({comments.data?.length ?? 0})</span>
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
                    </span>
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm">{c.content}</pre>
                </li>
              ))}
            </ul>
          ) : null}
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
              rows={2}
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="mt-2 flex justify-end">
              <button
                type="submit"
                disabled={!newComment.trim()}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
              >
                <Send size={12} />
                Comment
              </button>
            </div>
          </form>
        </section>
      </main>

      <aside className="space-y-3">
        <SidebarField label="Status">
          <select
            value={data.status ?? 'active'}
            onChange={(e) => patch.mutate({ status: e.target.value })}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </SidebarField>
        <SidebarField label="Due date">
          <input
            type="date"
            value={data.due_date ?? ''}
            onChange={(e) => patch.mutate({ due_date: e.target.value || null })}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          />
          {overdue ? <p className="mt-1 text-[10px] text-red-400">Overdue</p> : null}
        </SidebarField>
        <SidebarField label="Project">
          <select
            value={data.project_id ?? ''}
            onChange={(e) =>
              patch.mutate({ project_id: e.target.value ? parseInt(e.target.value) : null })
            }
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          >
            <option value="">No project</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </SidebarField>

        <button
          onClick={() => {
            if (confirm(`Delete milestone "${data.name}"?`)) remove.mutate()
          }}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive hover:bg-destructive/10"
        >
          <Trash2 size={12} />
          Delete milestone
        </button>

        <p className="text-[11px] text-muted-foreground" suppressHydrationWarning>
          {due ? `Due ${format(due, 'MMM d, yyyy')}` : 'No due date'}
        </p>
      </aside>
    </div>
  )
}

function SidebarField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card/30 p-3">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}
