'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Modal } from './ui/modal'
import { MultiSelect } from './listings/filter-bar'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from '@/lib/work-items'

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
interface LabelRow {
  id: number
  name: string
  color: string
}

interface Props {
  open: boolean
  onClose: () => void
  defaultProjectId?: number | null
  defaultMilestoneId?: number | null
  onCreated?: (issue: { id: number }) => void
}

export function IssueCreateModal({
  open,
  onClose,
  defaultProjectId,
  defaultMilestoneId,
  onCreated,
}: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: ws } = useActiveWorkspace()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('backlog')
  const [priority, setPriority] = useState(5)
  const [assigneeId, setAssigneeId] = useState('')
  const [projectId, setProjectId] = useState(defaultProjectId ? String(defaultProjectId) : '')
  const [milestoneId, setMilestoneId] = useState(defaultMilestoneId ? String(defaultMilestoneId) : '')
  const [labelIds, setLabelIds] = useState<Array<string | number>>([])
  const [dueDate, setDueDate] = useState('')

  useEffect(() => {
    if (open) {
      setProjectId(defaultProjectId ? String(defaultProjectId) : '')
      setMilestoneId(defaultMilestoneId ? String(defaultMilestoneId) : '')
    }
  }, [open, defaultProjectId, defaultMilestoneId])

  const members = useQuery({
    queryKey: ['ws-members', ws?.slug],
    enabled: !!ws && open,
    queryFn: async (): Promise<Member[]> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/members`)
      if (!res.ok) return []
      return (await res.json()).data
    },
  })
  const projects = useQuery({
    queryKey: ['ws-projects', ws?.slug],
    enabled: !!ws && open,
    queryFn: async (): Promise<Project[]> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects`)
      if (!res.ok) return []
      return (await res.json()).data
    },
  })
  const milestones = useQuery({
    queryKey: ['ws-milestones', ws?.slug],
    enabled: !!ws && open,
    queryFn: async (): Promise<Milestone[]> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/milestones`)
      if (!res.ok) return []
      return (await res.json()).data
    },
  })
  const labelList = useQuery({
    queryKey: ['ws-labels', ws?.slug],
    enabled: !!ws && open,
    queryFn: async (): Promise<LabelRow[]> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/labels`)
      if (!res.ok) return []
      return (await res.json()).data
    },
  })

  const filteredMilestones = (milestones.data ?? []).filter(
    (m) => !projectId || m.project_id === parseInt(projectId) || m.project_id == null
  )

  function reset() {
    setTitle('')
    setDescription('')
    setStatus('backlog')
    setPriority(5)
    setAssigneeId('')
    setProjectId(defaultProjectId ? String(defaultProjectId) : '')
    setMilestoneId(defaultMilestoneId ? String(defaultMilestoneId) : '')
    setLabelIds([])
    setDueDate('')
  }

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
      if (labelIds.length) body.label_ids = labelIds.map((v) => Number(v))
      if (dueDate) body.due_date = dueDate
      const res = await fetch(`/api/workspaces/${ws!.slug}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Could not create issue')
      }
      return res.json() as Promise<{ id: number; seq: number | null }>
    },
    onSuccess: (issue) => {
      toast.success(`Created ${ws?.key}-${issue.seq ?? issue.id}`)
      queryClient.invalidateQueries({ queryKey: ['ws-issues'] })
      reset()
      onCreated?.(issue)
      onClose()
      router.refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Modal open={open} onClose={onClose} title="New issue" widthClass="max-w-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim()) {
            toast.error('Title is required')
            return
          }
          create.mutate()
        }}
        className="space-y-4"
      >
        <div>
          <label className="mb-1 block text-xs font-medium">Title</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Short summary"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Add more detail (optional)"
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              {ISSUE_STATUSES.map((s) => (
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
              {ISSUE_PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
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
          <Field label="Due date">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Project">
            <select
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value)
                if (e.target.value && milestoneId) {
                  const m = (milestones.data ?? []).find((x) => x.id === parseInt(milestoneId))
                  if (m && m.project_id != null && m.project_id !== parseInt(e.target.value)) {
                    setMilestoneId('')
                  }
                }
              }}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">No project</option>
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
        </div>

        <Field label="Labels">
          <MultiSelect
            label="Add labels"
            options={(labelList.data ?? []).map((l) => ({ value: l.id, label: l.name, color: l.color }))}
            selected={labelIds}
            onChange={setLabelIds}
          />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {create.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
            Create issue
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">{label}</label>
      {children}
    </div>
  )
}
