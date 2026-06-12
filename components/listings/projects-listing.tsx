'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
import { toast } from 'sonner'
import { Folder, GripVertical, Plus } from 'lucide-react'
import { format } from 'date-fns'
import { useActiveWorkspace } from './use-active-workspace'
import { MultiSelect, SearchInput, ViewToggle, type ViewMode } from './filter-bar'
import { BulkActionBar, RowCheckbox, type BulkAction } from './bulk-action-bar'
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
import { PropertySelect } from '@/components/ui/property-select'
import { DatePicker } from '@/components/ui/date-picker'
import {
  PROJECT_STATUSES,
  PROJECT_PRIORITIES,
  projectStatusLabel,
  projectPriorityLabel,
  projectUpdateStatusLabel,
} from '@/lib/work-items'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useDeleteDialog } from '@/components/ui/delete-with-children-dialog'

interface ProjectRow {
  id: number
  workspace_id: number
  name: string
  summary: string | null
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
  owner_id: number | null
  lead_name: string | null
  lead_email: string | null
  lead_avatar: string | null
  health: string | null
  health_at: string | null
}

interface Member {
  user_id: number
  email: string
  name: string | null
  avatar_url: string | null
}

const PROJECT_STATUS_OPTIONS = PROJECT_STATUSES.map((s) => ({
  value: s.value,
  label: s.label,
  icon: <StatusIcon status={s.value} size={15} />,
}))

const PROJECT_PRIORITY_OPTIONS = PROJECT_PRIORITIES.map((p) => ({
  value: p.value,
  label: p.label,
  icon: <PriorityIcon priority={projectPriorityKey(p.value)} size={15} />,
}))


export function ProjectsListing() {
  const { data: ws } = useActiveWorkspace()
  const queryClient = useQueryClient()
  const router = useRouter()
  const { confirm } = useConfirm()
  const { confirmDelete } = useDeleteDialog()
  const [view, setView] = useState<ViewMode>('list')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<Array<string | number>>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const createProject = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Project' }),
      })
      if (!res.ok) throw new Error('Failed to create project')
      return res.json() as Promise<{ id: number }>
    },
    onSuccess: (project) => {
      router.push(`/dashboard/${project.id}?new=1`)
    },
    onError: () => toast.error('Failed to create project'),
  })

  const { data: members } = useQuery({
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

  const [localProjects, setLocalProjects] = useState(filtered)
  useEffect(() => { setLocalProjects(filtered) }, [filtered])

  const reorderProjects = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) throw new Error('failed')
    },
    onError: () => {
      toast.error('Reorder failed — reverting')
      setLocalProjects(filtered)
    },
  })

  function onProjectListDragEnd(result: DropResult) {
    if (!result.destination || result.source.index === result.destination.index) return
    const next = [...localProjects]
    const [moved] = next.splice(result.source.index, 1)
    next.splice(result.destination.index, 0, moved)
    setLocalProjects(next)
    reorderProjects.mutate(next.map((p) => p.id))
  }

  async function bulkPatch(patch: Record<string, unknown>) {
    const ids = Array.from(selectedIds)
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/workspaces/${ws!.slug}/projects/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
      )
    )
    queryClient.invalidateQueries({ queryKey: ['ws-projects-listing', ws?.slug] })
  }

  async function bulkDelete() {
    const ids = Array.from(selectedIds)
    const noun = ids.length === 1 ? 'project' : 'projects'
    const decision = await confirmDelete({
      kind: 'project',
      childLabel: `the issues and milestones inside the selected ${noun}`,
      confirmLabel: `Move ${ids.length} ${noun} to Trash`,
    })
    if (!decision) return
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/workspaces/${ws!.slug}/projects/${id}?mode=${decision.mode}`, {
            method: 'DELETE',
          })
        )
      )
      toast.success(`Moved ${ids.length} ${noun} to Trash`)
      setSelectedIds(new Set())
      queryClient.invalidateQueries({ queryKey: ['ws-projects-listing', ws?.slug] })
    } catch {
      toast.error('Some projects could not be deleted')
    }
  }

  const bulkActions: BulkAction[] = [
    {
      key: 'status',
      label: 'Status',
      options: PROJECT_STATUS_OPTIONS,
      onSelect: async (v) => {
        const ok = await confirm({
          title: `Change status for ${selectedIds.size} ${selectedIds.size === 1 ? 'project' : 'projects'}?`,
          description: 'All selected projects will be updated to the new status.',
          confirmLabel: 'Apply',
        })
        if (!ok) return
        await bulkPatch({ status: v })
        toast.success(`Updated status on ${selectedIds.size} ${selectedIds.size === 1 ? 'project' : 'projects'}`)
      },
    },
    {
      key: 'priority',
      label: 'Priority',
      options: PROJECT_PRIORITY_OPTIONS,
      onSelect: async (v) => {
        const ok = await confirm({
          title: `Change priority for ${selectedIds.size} ${selectedIds.size === 1 ? 'project' : 'projects'}?`,
          description: 'All selected projects will be updated to the new priority.',
          confirmLabel: 'Apply',
        })
        if (!ok) return
        await bulkPatch({ priority: v })
        toast.success(`Updated priority on ${selectedIds.size} ${selectedIds.size === 1 ? 'project' : 'projects'}`)
      },
    },
  ]

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2.5 border-b border-border bg-background/80 px-4 backdrop-blur">
        <span className="text-[15px] font-semibold">Projects</span>
        <span className="flex items-center justify-center rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium tabular-nums text-foreground/70 ring-1 ring-border/60">
          {filtered.length}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <button
            onClick={() => ws && createProject.mutate()}
            disabled={createProject.isPending || !ws}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            <Plus size={15} />
            New project
          </button>
        </div>
      </header>


<div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search projects…" />
        <MultiSelect label="Status" options={PROJECT_STATUS_OPTIONS} selected={status} onChange={setStatus} />
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
        <DragDropContext onDragEnd={onProjectListDragEnd}>
          <div>
            {/* Column header */}
            <div className="flex items-center gap-3 border-b border-border px-6 py-2.5 text-[13px] font-medium text-muted-foreground">
              <span className="w-8 shrink-0" />
              <span className="flex-1">Name</span>
              <span className="w-28 shrink-0">Health</span>
              <span className="w-28 shrink-0">Status</span>
              <span className="hidden w-20 shrink-0 lg:flex">Priority</span>
              <span className="hidden w-28 shrink-0 lg:flex">Lead</span>
              <span className="hidden w-24 shrink-0 lg:block">Target</span>
              <span className="w-12 shrink-0">Issues</span>
              <span className="w-20 shrink-0">Progress</span>
            </div>
            <Droppable droppableId="projects-list">
              {(provided) => (
                <ul ref={provided.innerRef} {...provided.droppableProps}>
                  {localProjects.map((p, idx) => (
                    <Draggable key={p.id} draggableId={String(p.id)} index={idx}>
                      {(prov, snap) => (
                        <ProjectRowItem
                          project={p}
                          wsSlug={ws?.slug ?? ''}
                          members={members ?? []}
                          selected={selectedIds.has(p.id)}
                          anySelected={selectedIds.size > 0}
                          onToggle={(checked) => {
                            const next = new Set(selectedIds)
                            if (checked) next.add(p.id)
                            else next.delete(p.id)
                            setSelectedIds(next)
                          }}
                          draggableRef={prov.innerRef}
                          draggableProps={prov.draggableProps}
                          dragHandleProps={prov.dragHandleProps}
                          isDragging={snap.isDragging}
                        />
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </ul>
              )}
            </Droppable>
          </div>
        </DragDropContext>
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

function ProjectRowItem({
  project: p,
  wsSlug,
  members,
  selected,
  anySelected,
  onToggle,
  draggableRef,
  draggableProps,
  dragHandleProps,
  isDragging,
}: {
  project: ProjectRow
  wsSlug: string
  members: Member[]
  selected: boolean
  anySelected: boolean
  onToggle: (checked: boolean) => void
  draggableRef?: React.Ref<HTMLLIElement>
  draggableProps?: object
  dragHandleProps?: object | null
  isDragging?: boolean
}) {
  const router = useRouter()
  const queryClient = useQueryClient()

  const total = p.issue_count ?? 0
  const open = p.open_issues ?? 0
  const done = total - open
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  const patch = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch(`/api/workspaces/${wsSlug}/projects/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ws-projects-listing', wsSlug] })
    },
  })

  const leadOptions = [
    {
      value: '',
      label: 'No lead',
      icon: <span className="size-[14px] rounded-full border border-dashed border-muted-foreground/40" />,
    },
    ...members.map((m) => ({
      value: String(m.user_id),
      label: m.name ?? m.email,
      icon: <MemberAvatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={15} />,
    })),
  ]

  function stop(e: React.MouseEvent) {
    e.stopPropagation()
  }

  return (
    <li
      ref={draggableRef as React.Ref<HTMLLIElement>}
      {...(draggableProps as object)}
      className={isDragging ? 'opacity-80 shadow-lg' : undefined}
    >
      <div
        onClick={() => {
          if (anySelected) {
            onToggle(!selected)
            return
          }
          router.push(`/dashboard/${p.id}`)
        }}
        className={`group flex h-12 cursor-pointer items-center gap-3 px-3 pl-2 transition-colors hover:bg-secondary/40 ${selected ? 'bg-primary/5' : ''}`}
      >
        {/* Drag handle */}
        <div
          {...(dragHandleProps as object)}
          className="flex shrink-0 cursor-grab items-center justify-center px-1 text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={14} />
        </div>
        {/* Checkbox */}
        <RowCheckbox
          checked={selected}
          onChange={onToggle}
          anySelected={anySelected}
          className="size-4 shrink-0"
        />

        {/* Name — navigates */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <ProjectIcon icon={p.icon} color={p.color} name={p.name} size={26} />
          <span className="truncate text-sm font-medium">{p.name}</span>
        </div>

        {/* Health — read-only */}
        <span className="flex w-28 shrink-0 items-center gap-1.5">
          <HealthIcon status={p.health} size={15} />
          <span className="truncate text-[13px] text-muted-foreground">
            {projectUpdateStatusLabel(p.health)}
          </span>
        </span>

        {/* Status — inline editable */}
        <div onClick={stop} className="w-28 shrink-0">
          <PropertySelect
            value={p.status}
            options={PROJECT_STATUS_OPTIONS}
            onChange={(v) => patch.mutate({ status: v })}
            noSearch
            buttonClassName="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-[13px] text-muted-foreground hover:bg-secondary"
          />
        </div>

        {/* Priority — inline editable */}
        <div onClick={stop} className="hidden w-20 shrink-0 lg:flex">
          <PropertySelect
            value={p.priority ?? 'P4'}
            options={PROJECT_PRIORITY_OPTIONS}
            onChange={(v) => patch.mutate({ priority: v })}
            noSearch
            buttonClassName="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-[13px] text-muted-foreground hover:bg-secondary"
          />
        </div>

        {/* Lead — inline editable */}
        <div onClick={stop} className="hidden w-28 shrink-0 lg:flex">
          <PropertySelect
            value={String(p.owner_id ?? '')}
            options={leadOptions}
            onChange={(v) => patch.mutate({ lead_user_id: v ? parseInt(v) : null })}
            noSearch
            align="right"
            buttonClassName="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-[13px] text-muted-foreground hover:bg-secondary"
          />
        </div>

        {/* Target date — inline editable */}
        <div onClick={stop} className="hidden w-24 shrink-0 lg:block">
          <DatePicker
            value={p.end_date}
            onChange={(v) => patch.mutate({ end_date: v })}
            placeholder="—"
            variant="chip"
            align="right"
            displayFormat="MMM d"
            hideIconWhenEmpty
            buttonClassName="flex w-full items-center gap-1 rounded px-1.5 py-1 text-[13px] text-muted-foreground hover:bg-secondary"
          />
        </div>

        {/* Issues count */}
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
