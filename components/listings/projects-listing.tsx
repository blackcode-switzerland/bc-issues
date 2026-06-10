'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Folder, Plus } from 'lucide-react'
import { format } from 'date-fns'
import { useActiveWorkspace } from './use-active-workspace'
import { MultiSelect, SearchInput, ViewToggle, type ViewMode } from './filter-bar'
import { ProjectCreateModal } from '../project-create-modal'
import { ProjectIcon } from '../project-icon'
import { ProjectsKanban } from './projects-kanban'
import { ProjectsTimeline } from './projects-timeline'
import {
  HealthIcon,
  PriorityIcon,
  ProgressRing,
  StatusIcon,
  projectPriorityKey,
} from '@/components/ui/work-item-icons'
import { MemberAvatar } from '@/components/ui/member-avatar'
import {
  PROJECT_STATUSES,
  projectStatusLabel,
  projectPriorityLabel,
  projectUpdateStatusLabel,
} from '@/lib/work-items'

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
  lead_name: string | null
  lead_email: string | null
  lead_avatar: string | null
  health: string | null
  health_at: string | null
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
    <div>
      <header className="sticky top-0 z-10 flex h-11 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur">
        <span className="text-[13px] font-medium">Projects</span>
        <span className="text-xs text-muted-foreground">{filtered.length}</span>
        <div className="ml-auto flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus size={14} />
            New project
          </button>
        </div>
      </header>

      <ProjectCreateModal open={showCreate} onClose={() => setShowCreate(false)} />

      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search projects…" />
        <MultiSelect label="Status" options={STATUSES} selected={status} onChange={setStatus} />
      </div>

      {projects.isLoading ? (
        <div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex h-11 items-center gap-3 px-6">
              <span className="size-[18px] animate-pulse rounded bg-secondary" />
              <span className="h-3 w-48 animate-pulse rounded bg-secondary" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Folder size={28} className="mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No projects yet.</p>
        </div>
      ) : view === 'kanban' ? (
        <div className="p-4">
          <ProjectsKanban projects={filtered} wsSlug={ws?.slug ?? ''} />
        </div>
      ) : view === 'timeline' ? (
        <div className="p-4">
          <ProjectsTimeline projects={filtered} />
        </div>
      ) : (
        <div>
          {/* Column header */}
          <div className="flex items-center gap-3 border-b border-border px-6 py-2 text-[11px] text-muted-foreground">
            <span className="flex-1">Name</span>
            <span className="w-28 shrink-0">Health</span>
            <span className="w-28 shrink-0">Status</span>
            <span className="hidden w-24 shrink-0 lg:flex">Priority</span>
            <span className="hidden w-32 shrink-0 lg:flex">Lead</span>
            <span className="hidden w-28 shrink-0 lg:block">Target date</span>
            <span className="w-12 shrink-0 text-right">Issues</span>
            <span className="w-20 shrink-0 text-right">Progress</span>
          </div>
          <ul>
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
                    className="flex h-11 items-center gap-3 px-6 transition-colors hover:bg-secondary/40"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <ProjectIcon icon={p.icon} color={p.color} name={p.name} size={18} />
                      <span className="truncate text-[13px] font-medium">{p.name}</span>
                    </div>
                    <span className="flex w-28 shrink-0 items-center gap-1.5">
                      <HealthIcon status={p.health} size={14} />
                      <span className="truncate text-xs text-muted-foreground">
                        {projectUpdateStatusLabel(p.health)}
                      </span>
                    </span>
                    <span className="flex w-28 shrink-0 items-center gap-1.5">
                      <StatusIcon status={p.status} size={14} />
                      <span className="truncate text-xs text-muted-foreground">
                        {projectStatusLabel(p.status)}
                      </span>
                    </span>
                    <span className="hidden w-24 shrink-0 items-center gap-1.5 lg:flex">
                      <PriorityIcon priority={projectPriorityKey(p.priority)} />
                      <span className="truncate text-xs text-muted-foreground">
                        {projectPriorityLabel(p.priority)}
                      </span>
                    </span>
                    <span className="hidden w-32 shrink-0 items-center gap-1.5 lg:flex">
                      {p.lead_name || p.lead_email ? (
                        <MemberAvatar
                          name={p.lead_name}
                          email={p.lead_email}
                          avatarUrl={p.lead_avatar}
                          size={18}
                        />
                      ) : (
                        <span className="size-[18px] shrink-0 rounded-full border border-dashed border-muted-foreground/40" />
                      )}
                      <span className="truncate text-xs text-muted-foreground">
                        {p.lead_name ?? p.lead_email ?? 'No lead'}
                      </span>
                    </span>
                    <span className="hidden w-28 shrink-0 text-xs text-muted-foreground lg:block">
                      {p.end_date ? format(new Date(p.end_date), 'MMM d') : '—'}
                    </span>
                    <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {total}
                    </span>
                    <span className="flex w-20 shrink-0 items-center justify-end gap-1.5">
                      <ProgressRing pct={pct} size={14} />
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {pct}%
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
