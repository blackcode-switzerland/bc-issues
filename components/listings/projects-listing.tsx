'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Folder, Plus } from 'lucide-react'
import { useActiveWorkspace } from './use-active-workspace'
import { FilterBar, MultiSelect, SearchInput, ViewToggle, type ViewMode } from './filter-bar'
import { ProjectCreateModal } from '../project-create-modal'
import { ProjectIcon } from '../project-icon'
import { ProjectsKanban } from './projects-kanban'
import { ProjectsTimeline } from './projects-timeline'
import { PROJECT_STATUSES } from '@/lib/work-items'

interface ProjectRow {
  id: number
  workspace_id: number
  name: string
  description: string | null
  status: string
  color: string | null
  icon: string | null
  priority: string | null
  start_date: string | null
  end_date: string | null
  created_at: string
  issue_count: number
  open_issues: number
  updated_at: string
}

const STATUSES = PROJECT_STATUSES.map((s) => ({ value: s.value, label: s.label }))

export function ProjectsListing() {
  const { data: ws } = useActiveWorkspace()
  const [view, setView] = useState<ViewMode>('list')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<Array<string | number>>([])
  const [showCreate, setShowCreate] = useState(false)

  const projects = useQuery({
    queryKey: ['ws-projects-listing', ws?.slug, { search, status }],
    enabled: !!ws,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (status.length === 1) params.set('status', String(status[0]))
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects?${params}`)
      if (!res.ok) throw new Error('failed')
      const j = await res.json()
      return j.data as ProjectRow[]
    },
  })

  const filtered = useMemo(() => {
    let data = projects.data ?? []
    if (status.length > 1) data = data.filter((p) => status.includes(p.status))
    return data
  }, [projects.data, status])

  return (
    <div className="p-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? 'project' : 'projects'}
            {ws ? ` in ${ws.name}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus size={14} />
            New project
          </button>
        </div>
      </header>

      <ProjectCreateModal open={showCreate} onClose={() => setShowCreate(false)} />

      <div className="mb-4 flex flex-col gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search projects…" />
        <FilterBar>
          <MultiSelect label="Status" options={STATUSES} selected={status} onChange={setStatus} />
        </FilterBar>
      </div>

      {projects.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card/30 p-16 text-center">
          <Folder size={32} className="mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No projects yet.</p>
        </div>
      ) : view === 'kanban' ? (
        <ProjectsKanban projects={filtered} wsSlug={ws?.slug ?? ''} />
      ) : view === 'timeline' ? (
        <ProjectsTimeline projects={filtered} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const total = p.issue_count ?? 0
            const open = p.open_issues ?? 0
            const done = total - open
            const pct = total > 0 ? Math.round((done / total) * 100) : 0
            return (
              <li key={p.id}>
                <Link
                  href={`/dashboard/${p.id}`}
                  prefetch={false}
                  className="block rounded-lg border border-border bg-card/30 p-4 transition-colors hover:bg-card/60"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <ProjectIcon icon={p.icon} color={p.color} name={p.name} size={28} />
                    <h3 className="flex-1 truncate text-sm font-semibold">{p.name}</h3>
                    <span className="rounded px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                      {p.status}
                    </span>
                  </div>
                  {p.description ? (
                    <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
                  ) : (
                    <p className="mb-3 text-xs italic text-muted-foreground">No description.</p>
                  )}
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      {open} open · {total} total
                    </span>
                    <span>{pct}%</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
