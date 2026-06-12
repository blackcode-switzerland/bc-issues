'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isPast, isToday } from 'date-fns'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Target } from 'lucide-react'
import { useActiveWorkspace } from './use-active-workspace'
import { MultiSelect, SearchInput } from './filter-bar'
import { BulkActionBar, RowCheckbox, type BulkAction } from './bulk-action-bar'
import { ProgressRing } from '@/components/ui/work-item-icons'
import { ProjectIcon } from '@/components/project-icon'
import { DatePicker } from '@/components/ui/date-picker'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useDeleteDialog } from '@/components/ui/delete-with-children-dialog'

interface MilestoneRow {
  id: number
  workspace_id: number
  project_id: number | null
  name: string
  description: string | null
  due_date: string | null
  status: string | null
  project_name: string | null
  project_icon: string | null
  project_color: string | null
  issue_count: number
  completed_issues: number
}

interface Project {
  id: number
  name: string
  icon: string | null
  color: string | null
}

export function MilestonesListing() {
  const { data: ws } = useActiveWorkspace()
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const { confirmDelete } = useDeleteDialog()
  const [search, setSearch] = useState('')
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
    queryKey: ['ws-milestones-listing', ws?.slug, { search, projectIds }],
    enabled: !!ws,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
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
    if (projectIds.length > 1) {
      data = data.filter((m) => {
        if (projectIds.includes('null')) return m.project_id == null || projectIds.includes(m.project_id ?? -1)
        return m.project_id != null && projectIds.includes(m.project_id)
      })
    }
    return data
  }, [milestones.data, projectIds])

  const projectOptions = [
    { value: 'null', label: 'No project', icon: <span className="size-[15px] rounded-full border border-dashed border-muted-foreground/40" /> },
    ...(projects.data ?? []).map((p) => ({
      value: p.id,
      label: p.name,
      icon: <ProjectIcon icon={p.icon} color={p.color} name={p.name} size={15} />,
    })),
  ]

  const PROJECT_ASSIGN_OPTIONS = [
    { value: '', label: 'No project', icon: <span className="size-[15px] rounded-full border border-dashed border-muted-foreground/40" /> },
    ...(projects.data ?? []).map((p) => ({
      value: p.id,
      label: p.name,
      icon: <ProjectIcon icon={p.icon} color={p.color} name={p.name} size={15} />,
    })),
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
    const noun = ids.length === 1 ? 'milestone' : 'milestones'
    const decision = await confirmDelete({
      kind: 'milestone',
      childLabel: `the issues in the selected ${noun}`,
      confirmLabel: `Move ${ids.length} ${noun} to Trash`,
    })
    if (!decision) return
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/workspaces/${ws!.slug}/milestones/${id}?mode=${decision.mode}`, {
            method: 'DELETE',
          })
        )
      )
      toast.success(`Moved ${ids.length} ${noun} to Trash`)
      setSelectedIds(new Set())
      queryClient.invalidateQueries({ queryKey: ['ws-milestones-listing', ws?.slug] })
    } catch {
      toast.error('Some milestones could not be deleted')
    }
  }

  const bulkActions: BulkAction[] = [
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
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2.5 border-b border-border bg-background/80 px-4 backdrop-blur">
        <span className="text-[15px] font-semibold">Milestones</span>
        <span className="flex items-center justify-center rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium tabular-nums text-foreground/70 ring-1 ring-border/60">
          {filtered.length}
        </span>
        <button
          onClick={() => ws && createMilestone.mutate()}
          disabled={createMilestone.isPending || !ws}
          className="ml-auto flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          <Plus size={15} />
          New milestone
        </button>
      </header>


<div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search milestones…" />
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
        <div>
          {/* Table header */}
          <div className="flex items-center gap-3 border-b border-border px-6 py-2.5 text-[13px] font-medium text-muted-foreground">
            <span className="w-4 shrink-0" />
            <span className="flex-1">Name</span>
            <span className="w-28 shrink-0">Project</span>
            <span className="w-24 shrink-0">Due date</span>
            <span className="w-12 shrink-0">Issues</span>
            <span className="w-20 shrink-0">Progress</span>
          </div>
          <ul>
            {filtered.map((m) => (
              <MilestoneRowItem
                key={m.id}
                milestone={m}
                wsSlug={ws?.slug ?? ''}
                selected={selectedIds.has(m.id)}
                anySelected={anySelected}
                onToggle={(checked) => {
                  const next = new Set(selectedIds)
                  if (checked) next.add(m.id)
                  else next.delete(m.id)
                  setSelectedIds(next)
                }}
              />
            ))}
          </ul>
        </div>
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

function MilestoneRowItem({
  milestone: m,
  wsSlug,
  selected,
  anySelected,
  onToggle,
}: {
  milestone: MilestoneRow
  wsSlug: string
  selected: boolean
  anySelected: boolean
  onToggle: (checked: boolean) => void
}) {
  const router = useRouter()
  const queryClient = useQueryClient()

  const total = m.issue_count ?? 0
  const done = m.completed_issues ?? 0
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const due = m.due_date ? new Date(m.due_date) : null
  const overdue = due ? isPast(due) && !isToday(due) && m.status !== 'completed' : false

  const patch = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch(`/api/workspaces/${wsSlug}/milestones/${m.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ws-milestones-listing', wsSlug] })
    },
  })

  function stop(e: React.MouseEvent) {
    e.stopPropagation()
  }

  return (
    <li>
      <div
        className={`group flex h-12 cursor-pointer items-center gap-3 px-6 transition-colors hover:bg-secondary/40 ${selected ? 'bg-primary/5' : ''}`}
        onClick={() => {
          if (anySelected) {
            onToggle(!selected)
            return
          }
          router.push(`/dashboard/milestones/${m.id}`)
        }}
      >
        {/* Checkbox */}
        <RowCheckbox
          checked={selected}
          onChange={onToggle}
          anySelected={anySelected}
          className="size-4 shrink-0"
        />

        {/* Name */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Target size={18} className="shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{m.name}</span>
        </div>

        {/* Project */}
        <span className="flex w-28 shrink-0 items-center gap-1.5 truncate text-[13px] text-muted-foreground">
          {m.project_name ? (
            <>
              <ProjectIcon icon={m.project_icon} color={m.project_color} name={m.project_name} size={15} />
              <span className="truncate">{m.project_name}</span>
            </>
          ) : '—'}
        </span>

        {/* Due date — inline editable */}
        <div onClick={stop} className="w-24 shrink-0">
          <DatePicker
            value={m.due_date}
            onChange={(v) => patch.mutate({ due_date: v })}
            placeholder="—"
            variant="chip"
            align="right"
            displayFormat="MMM d"
            hideIconWhenEmpty
            buttonClassName={`flex w-full items-center gap-1 rounded px-1.5 py-1 text-[13px] hover:bg-secondary ${overdue ? 'text-red-400' : 'text-muted-foreground'}`}
          />
        </div>

        {/* Issues */}
        <span className="w-12 shrink-0 text-[13px] tabular-nums text-muted-foreground">
          {total}
        </span>

        {/* Progress */}
        <span className="flex w-20 shrink-0 items-center gap-1.5">
          <ProgressRing pct={pct} size={15} />
          <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
        </span>
      </div>
    </li>
  )
}
