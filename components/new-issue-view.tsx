'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import { useActiveWorkspace } from './listings/use-active-workspace'

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

const STATUSES = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'in_review', label: 'In review' },
]

const PRIORITIES = [
  { value: 1, label: 'Urgent' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Medium' },
  { value: 4, label: 'Low' },
  { value: 5, label: 'None' },
]

export function NewIssueView() {
  const router = useRouter()
  const search = useSearchParams()
  const { data: ws } = useActiveWorkspace()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('backlog')
  const [priority, setPriority] = useState(3)
  const [assigneeId, setAssigneeId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [milestoneId, setMilestoneId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')

  // Pre-fill from query params (e.g. ?project_id=12)
  useEffect(() => {
    const p = search.get('project_id')
    if (p) setProjectId(p)
    const m = search.get('milestone_id')
    if (m) setMilestoneId(m)
  }, [search])

  const members = useQuery({
    queryKey: ['ws-members', ws?.slug],
    enabled: !!ws,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/members`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data as Member[]
    },
  })

  const projects = useQuery({
    queryKey: ['ws-projects', ws?.slug],
    enabled: !!ws,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data as Project[]
    },
  })

  const milestones = useQuery({
    queryKey: ['ws-milestones', ws?.slug],
    enabled: !!ws,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/milestones`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data as Milestone[]
    },
  })

  const create = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        title: title.trim(),
        status,
        priority,
      }
      if (description.trim()) body.description = description.trim()
      if (assigneeId) body.assignee_id = parseInt(assigneeId)
      if (projectId) body.project_id = parseInt(projectId)
      if (milestoneId) body.milestone_id = parseInt(milestoneId)
      if (startDate) body.start_date = startDate
      if (dueDate) body.due_date = dueDate

      const res = await fetch(`/api/workspaces/${ws!.slug}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'failed')
      }
      return res.json() as Promise<{ id: number; seq: number | null }>
    },
    onSuccess: (issue) => {
      toast.success(`Created ${ws?.key}-${issue.seq ?? issue.id}`)
      router.push(`/dashboard/issues/${issue.id}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Filter milestones to those matching the picked project (or standalone).
  const filteredMilestones = (milestones.data ?? []).filter(
    (m) => !projectId || m.project_id === parseInt(projectId) || m.project_id == null
  )

  return (
    <div className="mx-auto max-w-2xl p-6">
      <Link
        href="/dashboard/issues"
        className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        prefetch={false}
      >
        <ArrowLeft size={12} />
        Back to issues
      </Link>
      <h1 className="mb-1 text-2xl font-semibold">New issue</h1>
      <p className="mb-6 text-xs text-muted-foreground">
        Create an issue in <strong>{ws?.name ?? '…'}</strong>. Project and milestone are optional —
        you can leave both blank for a standalone issue.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim()) {
            toast.error('Title is required')
            return
          }
          create.mutate()
        }}
        className="space-y-4 rounded-lg border border-border bg-card/30 p-5"
      >
        <Field label="Title" required>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Short summary of the issue"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
        </Field>
        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={6}
            placeholder="What's the problem, expected behavior, repro steps…"
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value))}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Project">
            <select
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value)
                // If the picked milestone belongs to a different project, clear it.
                if (e.target.value && milestoneId) {
                  const m = (milestones.data ?? []).find((x) => x.id === parseInt(milestoneId))
                  if (m && m.project_id != null && m.project_id !== parseInt(e.target.value)) {
                    setMilestoneId('')
                  }
                }
              }}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">No project (standalone)</option>
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Milestone">
            <select
              value={milestoneId}
              onChange={(e) => setMilestoneId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">No milestone</option>
              {filteredMilestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assignee">
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">Unassigned</option>
              {(members.data ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name ?? m.email}
                </option>
              ))}
            </select>
          </Field>
          <div /> {/* spacer */}
          <Field label="Start date">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Due date">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Link
            href="/dashboard/issues"
            prefetch={false}
            className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={create.isPending || !title.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {create.isPending ? 'Creating…' : 'Create issue'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">
        {label} {required ? <span className="text-destructive">*</span> : null}
      </label>
      {children}
    </div>
  )
}
