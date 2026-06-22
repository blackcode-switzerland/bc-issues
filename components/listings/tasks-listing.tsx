'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isPast, isToday } from 'date-fns'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Target } from 'lucide-react'
import { useActiveWorkspace } from './use-active-workspace'
import { usePersistentState } from './use-persistent-filters'
import { ClearFiltersButton, MultiSelect, SearchInput, SortSelect } from './filter-bar'
import { sortItems, TASK_SORTS, SORT_MANUAL } from './sort'
import { BulkActionBar, RowCheckbox, type BulkAction } from './bulk-action-bar'
import { ProgressRing } from '@/components/ui/work-item-icons'
import { ProjectIcon } from '@/components/project-icon'
import { MemberAvatar } from '@/components/ui/member-avatar'
import { PropertySelect } from '@/components/ui/property-select'
import { DatePicker } from '@/components/ui/date-picker'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useDeleteDialog } from '@/components/ui/delete-with-children-dialog'
import {
  EmptyState,
  TaskSkeletonRow,
  AnimatePresence,
  motion,
  listContainerVariants,
  listItemVariants,
} from '@/components/ui/motion'

interface TaskRow {
  id: number
  seq: number | null
  workspace_id: number
  project_id: number | null
  name: string
  description: string | null
  due_date: string | null
  status: string | null
  project_name: string | null
  project_icon: string | null
  project_color: string | null
  lead_id: number | null
  lead_name: string | null
  lead_email: string | null
  lead_avatar: string | null
  issue_count: number
  completed_issues: number
  created_at?: string
  updated_at?: string
}

interface Project {
  id: number
  name: string
  icon: string | null
  color: string | null
}

interface Member {
  user_id: number
  email: string
  name: string | null
  avatar_url: string | null
}

export function TasksListing() {
  const { data: ws } = useActiveWorkspace()
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const { confirmDelete } = useDeleteDialog()
  // Filters persist across navigation (until a hard reload), scoped per workspace.
  const fk = (name: string) => `${ws?.slug ?? '~'}:tasks:${name}`
  const [search, setSearch] = usePersistentState(fk('search'), '')
  const [projectIds, setProjectIds] = usePersistentState<Array<string | number>>(fk('projectIds'), [])
  const [leadIds, setLeadIds] = usePersistentState<Array<string | number>>(fk('leadIds'), [])
  const [sort, setSort] = usePersistentState(fk('sort'), SORT_MANUAL)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const createTask = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Task' }),
      })
      if (!res.ok) throw new Error('Failed to create task')
      return res.json() as Promise<{ id: number; seq: number | null }>
    },
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ['ws-tasks-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['sidebar-counts'] })
      router.push(`/dashboard/${ws!.slug}/tasks/${task.seq ?? task.id}?new=1`)
    },
    onError: () => toast.error('Failed to create task'),
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

  const hasFilters = !!(search || projectIds.length || leadIds.length || sort !== SORT_MANUAL)
  const clearFilters = () => { setSearch(''); setProjectIds([]); setLeadIds([]); setSort(SORT_MANUAL) }

  const tasks = useQuery({
    queryKey: ['ws-tasks-listing', ws?.slug, { search, projectIds }],
    enabled: !!ws,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (projectIds.length === 1) {
        params.set('project_id', String(projectIds[0]))
      }
      const res = await fetch(`/api/workspaces/${ws!.slug}/tasks?${params}`)
      if (!res.ok) throw new Error('failed')
      const j = await res.json()
      return j.data as TaskRow[]
    },
  })

  const filtered = useMemo(() => {
    let data = tasks.data ?? []
    if (projectIds.length > 1) {
      data = data.filter((m) => {
        if (projectIds.includes('null')) return m.project_id == null || projectIds.includes(m.project_id ?? -1)
        return m.project_id != null && projectIds.includes(m.project_id)
      })
    }
    if (leadIds.length > 0) {
      const hasNull = leadIds.includes('null')
      data = data.filter((m) =>
        (hasNull && m.lead_id == null) || (m.lead_id != null && leadIds.includes(m.lead_id))
      )
    }
    return data
  }, [tasks.data, projectIds, leadIds])

  const sorted = useMemo(() => sortItems(filtered, sort), [filtered, sort])

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
        fetch(`/api/workspaces/${ws!.slug}/tasks/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
      )
    )
    queryClient.invalidateQueries({ queryKey: ['ws-tasks-listing', ws?.slug] })
    queryClient.invalidateQueries({ queryKey: ['ws-tasks'] })
    queryClient.invalidateQueries({ queryKey: ['project-tasks'] })
  }

  async function bulkDelete() {
    const ids = Array.from(selectedIds)
    const noun = ids.length === 1 ? 'task' : 'tasks'
    const decision = await confirmDelete({
      kind: 'task',
      childLabel: `the issues in the selected ${noun}`,
      confirmLabel: `Move ${ids.length} ${noun} to Trash`,
    })
    if (!decision) return
    // Optimistically remove from cache
    const snapshot = queryClient.getQueriesData<TaskRow[]>({ queryKey: ['ws-tasks-listing', ws?.slug] })
    queryClient.setQueriesData<TaskRow[]>(
      { queryKey: ['ws-tasks-listing', ws?.slug] },
      (old) => old?.filter((m) => !ids.includes(m.id))
    )
    setSelectedIds(new Set())
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/workspaces/${ws!.slug}/tasks/${id}?mode=${decision.mode}`, { method: 'DELETE' })
        )
      )
      toast.success(`Moved ${ids.length} ${noun} to Trash`)
      queryClient.invalidateQueries({ queryKey: ['ws-tasks-listing', ws?.slug] })
      queryClient.invalidateQueries({ queryKey: ['ws-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['ws-issues'] })
      queryClient.invalidateQueries({ queryKey: ['project-issues'] })
      queryClient.invalidateQueries({ queryKey: ['sidebar-counts'] })
    } catch {
      snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data))
      toast.error('Some tasks could not be deleted')
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
          title: `Move ${selectedIds.size} ${selectedIds.size === 1 ? 'task' : 'tasks'} to ${label}?`,
          description: 'All selected tasks will be reassigned to the chosen project.',
          confirmLabel: 'Apply',
        })
        if (!ok) return
        await bulkPatch({ project_id: v === '' ? null : Number(v) })
        toast.success(`Updated project on ${selectedIds.size} ${selectedIds.size === 1 ? 'task' : 'tasks'}`)
      },
    },
  ]

  const anySelected = selectedIds.size > 0
  const router = useRouter()

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2.5 border-b border-border bg-background/80 px-4 backdrop-blur">
        <span className="text-[15px] font-semibold">Tasks</span>
        <span className="flex items-center justify-center rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium tabular-nums text-foreground/70 ring-1 ring-border/60">
          {filtered.length}
        </span>
        <button
          onClick={() => ws && createTask.mutate()}
          disabled={createTask.isPending || !ws}
          className="ml-auto flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          <Plus size={15} />
          New task
        </button>
      </header>


<div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search tasks…" />
        <MultiSelect
          label="Project"
          options={projectOptions}
          selected={projectIds}
          onChange={setProjectIds}
        />
        <MultiSelect
          label="Lead"
          searchable
          options={[
            { value: 'null', label: 'No lead', icon: <span className="size-[15px] rounded-full border border-dashed border-muted-foreground/40" /> },
            ...(members ?? []).map((m) => ({
              value: m.user_id,
              label: m.name ?? m.email,
              icon: <MemberAvatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={15} />,
            })),
          ]}
          selected={leadIds}
          onChange={setLeadIds}
        />
        <SortSelect value={sort} options={TASK_SORTS} onChange={setSort} />
        <ClearFiltersButton active={hasFilters} onClick={clearFilters} />
      </div>

      {tasks.isLoading ? (
        <div>
          {Array.from({ length: 8 }).map((_, i) => (
            <TaskSkeletonRow key={i} i={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<Target size={28} />}
            title="No tasks found"
            description="No tasks match your current filters."
            secondaryAction={{ label: 'Clear filters', onClick: clearFilters }}
          />
        ) : (
          <EmptyState
            icon={<Target size={28} />}
            title="No tasks yet"
            description="Create tasks to track and group related issues."
            action={{ label: <><Plus size={14} />New task</>, onClick: () => ws && createTask.mutate(), loading: createTask.isPending }}
          />
        )
      ) : (
        <div>
          {/* Table header */}
          <div className="flex items-center gap-3 border-b border-border px-6 py-2.5 text-[13px] font-medium text-muted-foreground">
            <span className="w-4 shrink-0" />
            <span className="flex-1">Name</span>
            <span className="hidden w-28 shrink-0 sm:block">Project</span>
            <span className="hidden w-28 shrink-0 lg:flex">Lead</span>
            <span className="w-24 shrink-0">Due date</span>
            <span className="hidden w-12 shrink-0 sm:block">Issues</span>
            <span className="w-20 shrink-0">Progress</span>
          </div>
          <motion.ul
            variants={listContainerVariants}
            initial="hidden"
            animate="show"
          >
            <AnimatePresence initial={false}>
            {sorted.map((m) => (
              <motion.div
                key={m.id}
                variants={listItemVariants}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                layout
              >
                <TaskRowItem
                  task={m}
                  wsSlug={ws?.slug ?? ''}
                  members={members ?? []}
                  selected={selectedIds.has(m.id)}
                  anySelected={anySelected}
                  onToggle={(checked) => {
                    const next = new Set(selectedIds)
                    if (checked) next.add(m.id)
                    else next.delete(m.id)
                    setSelectedIds(next)
                  }}
                />
              </motion.div>
            ))}
            </AnimatePresence>
          </motion.ul>
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

function TaskRowItem({
  task: m,
  wsSlug,
  members,
  selected,
  anySelected,
  onToggle,
}: {
  task: TaskRow
  wsSlug: string
  members: Member[]
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
      const res = await fetch(`/api/workspaces/${wsSlug}/tasks/${m.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ['ws-tasks-listing', wsSlug] })
      const snapshot = queryClient.getQueriesData<TaskRow[]>({ queryKey: ['ws-tasks-listing', wsSlug] })
      queryClient.setQueriesData<TaskRow[]>(
        { queryKey: ['ws-tasks-listing', wsSlug] },
        (old) => old?.map((item) => (item.id === m.id ? { ...item, ...data } : item))
      )
      return { snapshot }
    },
    onError: (_err, _data, ctx) => {
      ctx?.snapshot?.forEach(([key, data]) => queryClient.setQueryData(key, data))
      toast.error('Could not update task')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['ws-tasks-listing', wsSlug] })
      queryClient.invalidateQueries({ queryKey: ['ws-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task', m.id] })
      queryClient.invalidateQueries({ queryKey: ['project-tasks'] })
    },
  })

  const leadOptions = [
    {
      value: '',
      label: 'No lead',
      icon: <span className="size-[14px] rounded-full border border-dashed border-muted-foreground/40" />,
    },
    ...members.map((mem) => ({
      value: String(mem.user_id),
      label: mem.name ?? mem.email,
      icon: <MemberAvatar name={mem.name} email={mem.email} avatarUrl={mem.avatar_url} size={15} />,
    })),
  ]

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
          router.push(`/dashboard/${wsSlug}/tasks/${m.seq ?? m.id}`)
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
          {m.seq != null ? (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">#{m.seq}</span>
          ) : null}
          <span className="truncate text-sm font-medium">{m.name}</span>
        </div>

        {/* Project */}
        <span className="hidden w-28 shrink-0 items-center gap-1.5 truncate text-[13px] text-muted-foreground sm:flex">
          {m.project_name ? (
            <>
              <ProjectIcon icon={m.project_icon} color={m.project_color} name={m.project_name} size={15} />
              <span className="truncate">{m.project_name}</span>
            </>
          ) : '—'}
        </span>

        {/* Lead — inline editable */}
        <div onClick={stop} className="hidden w-28 shrink-0 lg:flex">
          <PropertySelect
            value={String(m.lead_id ?? '')}
            options={leadOptions}
            onChange={(v) => patch.mutate({ lead_user_id: v ? parseInt(v) : null })}
            noSearch
            align="right"
            buttonClassName="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-[13px] text-muted-foreground hover:bg-secondary"
          />
        </div>

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
        <span className="hidden w-12 shrink-0 text-[13px] tabular-nums text-muted-foreground sm:block">
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
