'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { ArrowLeft, Edit3, Send, Trash2 } from 'lucide-react'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { ProjectIcon } from './project-icon'
import { IconPicker } from './icon-picker'
import { PROJECT_STATUSES } from '@/lib/work-items'

interface ProjectDetail {
  id: number
  workspace_id: number
  name: string
  description: string | null
  status: string
  color: string | null
  icon: string | null
  owner_id: number | null
  start_date: string | null
  end_date: string | null
  created_at: string
}

interface IssueRow {
  id: number
  seq: number | null
  title: string
  status: string
  assignee_name: string | null
}

interface MilestoneRow {
  id: number
  name: string
  due_date: string | null
  status: string | null
  issue_count: number
  completed_issues: number
}

interface Comment {
  id: number
  content: string
  created_at: string
  author_name: string | null
  author_email: string | null
}

const STATUSES = PROJECT_STATUSES.map((s) => ({ value: s.value, label: s.label }))

export function ProjectDetailView({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient()
  const { data: ws } = useActiveWorkspace()
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const [newComment, setNewComment] = useState('')

  const project = useQuery({
    queryKey: ['project', projectId, ws?.slug],
    enabled: !!ws,
    queryFn: async (): Promise<ProjectDetail | null> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects/${projectId}`)
      if (!res.ok) return null
      return res.json()
    },
  })

  const issues = useQuery({
    queryKey: ['project-issues', projectId, ws?.slug],
    enabled: !!ws,
    queryFn: async (): Promise<IssueRow[]> => {
      const res = await fetch(
        `/api/workspaces/${ws!.slug}/issues?project_id=${projectId}&limit=200`
      )
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })

  const milestones = useQuery({
    queryKey: ['project-milestones', projectId, ws?.slug],
    enabled: !!ws,
    queryFn: async (): Promise<MilestoneRow[]> => {
      const res = await fetch(
        `/api/workspaces/${ws!.slug}/milestones?project_id=${projectId}`
      )
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })

  const comments = useQuery({
    queryKey: ['project-comments', projectId, ws?.slug],
    enabled: !!ws,
    queryFn: async (): Promise<Comment[]> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects/${projectId}/comments`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })

  const patch = useMutation({
    mutationFn: async (input: Record<string, unknown>) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
      queryClient.invalidateQueries({ queryKey: ['ws-projects-listing'] })
    },
    onError: () => toast.error('Failed to update project'),
  })

  const createComment = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects/${projectId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      setNewComment('')
      queryClient.invalidateQueries({ queryKey: ['project-comments', projectId] })
    },
  })

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects/${projectId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      toast.success('Project deleted')
      window.location.href = '/dashboard'
    },
  })

  useEffect(() => {
    if (project.data && !editingName) setNameDraft(project.data.name)
  }, [project.data, editingName])
  useEffect(() => {
    if (project.data && !editingDesc) setDescDraft(project.data.description ?? '')
  }, [project.data, editingDesc])

  if (project.isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>
  }
  if (!project.data) {
    return (
      <div className="p-8">
        <Link href="/dashboard" className="text-xs text-muted-foreground hover:underline">
          ← Back to projects
        </Link>
        <p className="mt-4 text-sm">Project not found.</p>
      </div>
    )
  }

  const data = project.data
  const total = issues.data?.length ?? 0
  const done = issues.data?.filter((i) => i.status === 'done' || i.status === 'cancelled').length ?? 0
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_280px]">
      <main>
        <Link
          href="/dashboard"
          className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          prefetch={false}
        >
          <ArrowLeft size={12} />
          Back to projects
        </Link>

        <div className="mb-2 flex items-center gap-3">
          <ProjectIcon icon={data.icon} color={data.color} name={data.name} size={32} />
          {editingName ? (
            <div className="flex flex-1 gap-2">
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                maxLength={100}
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-2xl font-semibold outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={() =>
                  patch.mutate({ name: nameDraft }, { onSuccess: () => setEditingName(false) })
                }
                className="rounded-md bg-primary px-3 text-sm text-primary-foreground"
              >
                Save
              </button>
              <button
                onClick={() => setEditingName(false)}
                className="rounded-md border border-border px-3 text-sm"
              >
                Cancel
              </button>
            </div>
          ) : (
            <h1
              onDoubleClick={() => setEditingName(true)}
              className="cursor-text text-2xl font-semibold"
            >
              {data.name}
            </h1>
          )}
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          {data.status} · {total} issues · {pct}% complete
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
                  className="rounded-md border border-border px-3 py-1.5 text-xs"
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

        {milestones.data?.length ? (
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-medium">
              Milestones <span className="text-muted-foreground">({milestones.data.length})</span>
            </h2>
            <ul className="divide-y divide-border rounded-lg border border-border bg-card/30">
              {milestones.data.map((m) => {
                const t = m.issue_count ?? 0
                const d = m.completed_issues ?? 0
                const p = t > 0 ? Math.round((d / t) * 100) : 0
                return (
                  <li key={m.id}>
                    <Link
                      href={`/dashboard/milestones/${m.id}`}
                      prefetch={false}
                      className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-secondary/50"
                    >
                      <span className="flex-1 truncate">{m.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {d}/{t} ({p}%)
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}

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
            <p className="text-sm italic text-muted-foreground">No issues in this project yet.</p>
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
            value={data.status}
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
        <SidebarField label="Icon & color">
          <IconPicker
            icon={data.icon}
            color={data.color ?? '#3b82f6'}
            name={data.name}
            onChange={(v) => patch.mutate({ icon: v.icon, color: v.color })}
          />
        </SidebarField>
        <SidebarField label="Start date">
          <input
            type="date"
            value={data.start_date ?? ''}
            onChange={(e) => patch.mutate({ start_date: e.target.value || null })}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          />
        </SidebarField>
        <SidebarField label="End date">
          <input
            type="date"
            value={data.end_date ?? ''}
            onChange={(e) => patch.mutate({ end_date: e.target.value || null })}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          />
        </SidebarField>

        <button
          onClick={() => {
            if (confirm(`Delete project "${data.name}"? Issues and milestones in it will become standalone.`)) {
              remove.mutate()
            }
          }}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive hover:bg-destructive/10"
        >
          <Trash2 size={12} />
          Delete project
        </button>
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
