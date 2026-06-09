'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Modal } from './ui/modal'
import { useActiveWorkspace } from './listings/use-active-workspace'

interface Project {
  id: number
  name: string
}

interface Props {
  open: boolean
  onClose: () => void
  /** Prefill the project (e.g. opening from a project page). */
  defaultProjectId?: number | null
  onCreated?: (milestone: { id: number }) => void
}

export function MilestoneCreateModal({ open, onClose, defaultProjectId, onCreated }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: ws } = useActiveWorkspace()

  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState<string>(defaultProjectId ? String(defaultProjectId) : '')
  const [dueDate, setDueDate] = useState('')

  const projects = useQuery({
    queryKey: ['ws-projects', ws?.slug],
    enabled: !!ws && open,
    queryFn: async (): Promise<Project[]> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })

  function reset() {
    setName('')
    setProjectId(defaultProjectId ? String(defaultProjectId) : '')
    setDueDate('')
  }

  const create = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        name: name.trim(),
        project_id: projectId ? parseInt(projectId) : null,
      }
      if (dueDate) body.due_date = dueDate
      const res = await fetch(`/api/workspaces/${ws!.slug}/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Could not create milestone')
      }
      return res.json() as Promise<{ id: number; name: string }>
    },
    onSuccess: (milestone) => {
      toast.success(`Created ${milestone.name}`)
      queryClient.invalidateQueries({ queryKey: ['ws-milestones-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-milestones'] })
      reset()
      onCreated?.(milestone)
      onClose()
      router.refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Modal open={open} onClose={onClose} title="New milestone">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) {
            toast.error('Milestone name is required')
            return
          }
          create.mutate()
        }}
        className="space-y-4"
      >
        <div>
          <label className="mb-1 block text-xs font-medium">Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="v1.0 Launch"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium">Project</label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
          >
            <option value="">No project (standalone)</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium">Target date</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
        </div>

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
            Create milestone
          </button>
        </div>
      </form>
    </Modal>
  )
}
