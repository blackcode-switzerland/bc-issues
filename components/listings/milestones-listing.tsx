'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { format, isPast, isToday } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { Plus, Target } from 'lucide-react'
import { useActiveWorkspace } from './use-active-workspace'
import { MultiSelect, SearchInput } from './filter-bar'
import { MilestoneCreateModal } from '../milestone-create-modal'
import { ProgressRing } from '@/components/ui/work-item-icons'

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
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<Array<string | number>>([])
  const [projectIds, setProjectIds] = useState<Array<string | number>>([])
  const [showCreate, setShowCreate] = useState(false)

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

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-11 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur">
        <span className="text-[13px] font-medium">Milestones</span>
        <span className="text-xs text-muted-foreground">{filtered.length}</span>
        <button
          onClick={() => setShowCreate(true)}
          className="ml-auto flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus size={14} />
          New milestone
        </button>
      </header>

      <MilestoneCreateModal open={showCreate} onClose={() => setShowCreate(false)} />

      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
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
            return (
              <li key={m.id}>
                <Link
                  href={`/dashboard/milestones/${m.id}`}
                  prefetch={false}
                  className="flex h-11 items-center gap-3 px-6 transition-colors hover:bg-secondary/40"
                >
                  <Target size={14} className="shrink-0 text-muted-foreground" />
                  <span className="truncate text-[13px] font-medium">{m.name}</span>
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                    {m.project_name ?? 'Standalone'}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    <ProgressRing pct={pct} size={14} />
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {done}/{total} issues
                    </span>
                  </span>
                  <span
                    className={`w-20 shrink-0 text-right text-xs ${
                      overdue ? 'text-red-400' : 'text-muted-foreground'
                    }`}
                  >
                    {due ? format(due, 'MMM d') : '—'}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
