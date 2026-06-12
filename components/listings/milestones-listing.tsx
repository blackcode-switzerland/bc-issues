'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format, isPast, isToday } from 'date-fns'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Target } from 'lucide-react'
import { useActiveWorkspace } from './use-active-workspace'
import { MultiSelect, SearchInput } from './filter-bar'
import { BulkActionBar, RowCheckbox, type BulkAction } from './bulk-action-bar'
import { ProgressRing } from '@/components/ui/work-item-icons'
import { useConfirm } from '@/components/ui/confirm-dialog'

interface MilestoneRow {
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

interface Project {
  id: number
  name: string
}

const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export function MilestonesListing() {
  const { data: ws } = useActiveWorkspace()
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<Array<string | number>>([])
  const [projectIds, setProjectIds] = useState<Array<string | number>>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const createMilestone = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Milestone' }),
      })
      if (!res.ok) throw new Error('Failed to create milestone')
      return res.json() as Promise<{ id: number }>
    },
    onSuccess: (milestone) => {
      router.push(`/dashboard/milestones/${milestone.id}?new=1`)
    },
    onError: () => toast.error('Failed to create milestone'),
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
    queryKey: ['ws-milestones-listing', ws?.slug, { search, status, projectIds }],
    enabled: !!ws,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (status.length === 1) params.set('status', String(status[0]))
      if (projectIds.length === 1) {
        params.set('project_id', String(projectIds[0]))
      }
      const res = await fetch(`/api/workspaces/${ws!.slug}/milestones?${params}`)
      if (!res.ok) throw new Error('failed')
      const j = await res.json()
      return j.data as MilestoneRow[]
    },
  })

  const filtered = useMemo(() => {
    let data = milestones.data ?? []
    if (status.length > 1) data = data.filter((m) => status.includes(m.status ?? ''))
    if (projectIds.length > 1) {
      data = data.filter((m) => {
        if (projectIds.includes('null')) return m.project_id == null || projectIds.includes(m.project_id ?? -1)
        return m.project_id != null && projectIds.includes(m.project_id)
      })
    }
    return data
  }, [milestones.data, status, projectIds])

  const projectOptions = [
    { value: 'null', label: 'No project (standalone)' },
    ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name })),
  ]

  const PROJECT_ASSIGN_OPTIONS = [
    { value: '', label: 'No project (standalone)' },
    ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name })),
  ]

  async function bulkPatch(patch: Record<string, unknown>) {
    const ids = Array.from(selectedIds)
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/workspaces/${ws!.slug}/milestones/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
      )
    )
    queryClient.invalidateQueries({ queryKey: ['ws-milestones-listing', ws?.slug] })
  }

  async function bulkDelete() {
    const ids = Array.from(selectedIds)
    const ok = await confirm({
      title: `Delete ${ids.length} ${ids.length === 1 ? 'milestone' : 'milestones'}?`,
      description:
        'Issues in these milestones will become unassigned. This action cannot be undone.',
      destructive: true,
      confirmLabel: `Delete ${ids.length} ${ids.length === 1 ? 'milestone' : 'milestones'}`,
    })
    if (!ok) return
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/workspaces/${ws!.slug}/milestones/${id}`, { method: 'DELETE' })
        )
      )
      toast.success(`Deleted ${ids.length} ${ids.length === 1 ? 'milestone' : 'milestones'}`)
      setSelectedIds(new Set())
      queryClient.invalidateQueries({ queryKey: ['ws-milestones-listing', ws?.slug] })
    } catch {
      toast.error('Some milestones could not be deleted')
    }
  }

  const bulkActions: BulkAction[] = [
    {
      key: 'status',
      label: 'Status',
      options: STATUSES,
      onSelect: async (v) => {
        const ok = await confirm({
          title: `Change status for ${selectedIds.size} ${selectedIds.size === 1 ? 'milestone' : 'milestones'}?`,
          description: 'All selected milestones will be updated to the new status.',
          confirmLabel: 'Apply',
        })
        if (!ok) return
        await bulkPatch({ status: v })
        toast.success(`Updated status on ${selectedIds.size} ${selectedIds.size === 1 ? 'milestone' : 'milestones'}`)
      },
    },
    {
      key: 'project',
      label: 'Assign project',
      options: PROJECT_ASSIGN_OPTIONS,
      searchable: (projects.data?.length ?? 0) > 5,
      onSelect: async (v) => {
        const proj = projects.data?.find((p) => p.id === Number(v))
        const label = proj ? `"${proj.name}"` : 'no project'
        const ok = await confirm({
          title: `Move ${selectedIds.size} ${selectedIds.size === 1 ? 'milestone' : 'milestones'} to ${label}?`,
          description: 'All selected milestones will be reassigned to the chosen project.',
          confirmLabel: 'Apply',
        })
        if (!ok) return
        await bulkPatch({ project_id: v === '' ? null : Number(v) })
        toast.success(`Updated project on ${selectedIds.size} ${selectedIds.size === 1 ? 'milestone' : 'milestones'}`)
      },
    },
  ]

  const anySelected = selectedIds.size > 0
  const router = useRouter()

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-11 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur">
        <span className="text-sm font-semibold">Milestones</span>
        <span className="text-xs text-muted-foreground">{filtered.length}</span>
        <button
          onClick={() => ws && createMilestone.mutate()}
          disabled={createMilestone.isPending || !ws}
          className="ml-auto flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          <Plus size={13} />
          New milestone
        </button>
      </header>


<div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <SearchInput value={search} onChange={setSearch} placeholder="Search milestones…" />
        <MultiSelect label="Status" options={STATUSES} selected={status} onChange={setStatus} />
        <MultiSelect
          label="Project"
          options={projectOptions}
          selected={projectIds}
          onChange={setProjectIds}
        />
      </div>

      {milestones.isLoading ? (
        <div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex h-11 items-center gap-3 px-6">
              <span className="size-3.5 animate-pulse rounded bg-secondary" />
              <span className="h-3 w-48 animate-pulse rounded bg-secondary" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Target size={28} className="mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No milestones match your filters.</p>
        </div>
      ) : (
        <ul>
          {filtered.map((m) => {
            const total = m.issue_count ?? 0
            const done = m.completed_issues ?? 0
            const pct = total > 0 ? Math.round((done / total) * 100) : 0
            const due = m.due_date ? new Date(m.due_date) : null
            const overdue = due ? isPast(due) && !isToday(due) && m.status !== 'completed' : false
            const isSelected = selectedIds.has(m.id)
            return (
              <li key={m.id}>
                <div
                  className={`group flex h-11 cursor-pointer items-center gap-3 border-b border-border/50 px-6 transition-colors hover:bg-secondary/40 ${isSelected ? 'bg-primary/5' : ''}`}
                  onClick={() => {
                    if (anySelected) {
                      const next = new Set(selectedIds)
                      if (isSelected) next.delete(m.id)
                      else next.add(m.id)
                      setSelectedIds(next)
                    }
                  }}
                >
                  {/* Checkbox */}
                  <RowCheckbox
                    checked={isSelected}
                    onChange={(checked) => {
                      const next = new Set(selectedIds)
                      if (checked) next.add(m.id)
                      else next.delete(m.id)
                      setSelectedIds(next)
                    }}
                    anySelected={anySelected}
                    className="size-4 shrink-0"
                  />

                  {/* Content — navigates when not in selection mode */}
                  <div
                    className="flex flex-1 items-center gap-3 overflow-hidden"
                    onClick={(e) => {
                      if (!anySelected) {
                        e.stopPropagation()
                        router.push(`/dashboard/milestones/${m.id}`)
                      }
                    }}
                  >
                    <Target size={14} className="shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm font-medium">{m.name}</span>
                    {m.project_name ? (
                      <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {m.project_name}
                      </span>
                    ) : null}
                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                      <ProgressRing pct={pct} size={14} />
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {done}/{total}
                      </span>
                    </span>
                    <span
                      className={`w-16 shrink-0 text-right text-xs ${
                        overdue ? 'text-red-400' : 'text-muted-foreground'
                      }`}
                    >
                      {due ? format(due, 'MMM d') : '—'}
                    </span>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <BulkActionBar
        count={selectedIds.size}
        onClear={() => setSelectedIds(new Set())}
        actions={bulkActions}
        onDelete={bulkDelete}
        deleteLabel={`Delete ${selectedIds.size}`}
      />
    </div>
  )
}
