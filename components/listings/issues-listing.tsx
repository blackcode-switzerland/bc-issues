'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { ChevronDown, CircleDot, GripVertical, Plus, Target } from 'lucide-react'
import { useActiveWorkspace } from './use-active-workspace'
import { FilterBar, MultiSelect, SearchInput, ViewToggle, type ViewMode } from './filter-bar'
import { BulkActionBar, RowCheckbox, type BulkAction } from './bulk-action-bar'
import { IssuesKanban } from './issues-kanban'
import { IssuesTimeline } from './issues-timeline'
import { StatusIcon, PriorityIcon, issuePriorityKey } from '@/components/ui/work-item-icons'
import { MemberAvatar } from '@/components/ui/member-avatar'
import { PropertySelect } from '@/components/ui/property-select'
import { ProjectIcon } from '../project-icon'
import { ISSUE_PRIORITIES, ISSUE_STATUSES, issueStatusLabel } from '@/lib/work-items'
import { useConfirm } from '@/components/ui/confirm-dialog'

interface IssueRow {
  id: number
  workspace_id: number
  seq: number | null
  title: string
  status: string
  priority: number
  project_id: number | null
  milestone_id: number | null
  assignee_id: number | null
  assignee_name: string | null
  assignee_email: string | null
  milestone_name: string | null
  project_name: string | null
  project_icon: string | null
  project_color: string | null
  comment_count: number
  attachment_count: number
  start_date: string | null
  due_date: string | null
  created_at: string
  updated_at: string
  labels: Array<{ id: number; name: string; color: string }>
}

type LabelFilterMode = 'any' | 'all' | 'exclude_any' | 'exclude_all'

const LABEL_FILTER_MODES: { value: LabelFilterMode; label: string }[] = [
  { value: 'any', label: 'include any of' },
  { value: 'all', label: 'include all of' },
  { value: 'exclude_any', label: 'exclude if any of' },
  { value: 'exclude_all', label: 'exclude if all' },
]

interface Member {
  user_id: number
  email: string
  name: string | null
  avatar_url: string | null
}

interface Project {
  id: number
  name: string
  color?: string | null
  icon?: string | null
}

interface Milestone {
  id: number
  name: string
}

interface LabelRow {
  id: number
  name: string
  color: string
}

const STATUSES = ISSUE_STATUSES.map((s) => ({ value: s.value, label: s.label }))
const PRIORITIES = ISSUE_PRIORITIES.map((p) => ({ value: p.value, label: p.label }))

export function IssuesListing() {
  const { data: ws } = useActiveWorkspace()
  const queryClient = useQueryClient()
  const router = useRouter()
  const { confirm } = useConfirm()
  const [view, setView] = useState<ViewMode>('list')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<Array<string | number>>([])
  const [priority, setPriority] = useState<Array<string | number>>([])
  const [assignees, setAssignees] = useState<Array<string | number>>([])
  const [projects, setProjects] = useState<Array<string | number>>([])
  const [milestones, setMilestones] = useState<Array<string | number>>([])
  const [labels, setLabels] = useState<Array<string | number>>([])
  const [labelMode, setLabelMode] = useState<LabelFilterMode>('any')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const createIssue = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Issue' }),
      })
      if (!res.ok) throw new Error('Failed to create issue')
      return res.json() as Promise<{ id: number; seq: number | null }>
    },
    onSuccess: (issue) => {
      router.push(`/dashboard/issues/${issue.id}?new=1`)
    },
    onError: () => toast.error('Failed to create issue'),
  })

  // Load filter source data
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
  const { data: projectList } = useQuery({
    queryKey: ['ws-projects', ws?.slug],
    enabled: !!ws,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data as Project[]
    },
  })
  const { data: milestoneList } = useQuery({
    queryKey: ['ws-milestones', ws?.slug],
    enabled: !!ws,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/milestones`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data as Milestone[]
    },
  })
  const { data: labelList } = useQuery({
    queryKey: ['ws-labels', ws?.slug],
    enabled: !!ws,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/labels`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data as LabelRow[]
    },
  })

  const issuesQuery = useQuery({
    queryKey: ['ws-issues', ws?.slug, { search, status, priority, assignees, projects, milestones, labels, labelMode }],
    enabled: !!ws,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (status.length === 1) params.set('status', String(status[0]))
      if (priority.length === 1) params.set('priority', String(priority[0]))
      if (assignees.length === 1) params.set('assignee_id', String(assignees[0]))
      if (projects.length === 1 && projects[0] !== 'null') params.set('project_id', String(projects[0]))
      if (milestones.length === 1 && milestones[0] !== 'null') params.set('milestone_id', String(milestones[0]))
      params.set('limit', '200')
      const res = await fetch(`/api/workspaces/${ws!.slug}/issues?${params}`)
      if (!res.ok) throw new Error('failed')
      const j = await res.json()
      return j.data as IssueRow[]
    },
  })

  const filtered = useMemo(() => {
    let data = issuesQuery.data ?? []
    if (status.length > 1) data = data.filter((d) => status.includes(d.status))
    if (priority.length > 1) data = data.filter((d) => priority.includes(d.priority))
    if (assignees.length > 1)
      data = data.filter((d) => d.assignee_id != null && assignees.includes(d.assignee_id))
    if (projects.length > 1 || projects.includes('null')) {
      const hasNull = projects.includes('null')
      data = data.filter((d) =>
        (hasNull && d.project_id == null) || (d.project_id != null && projects.includes(d.project_id))
      )
    }
    if (milestones.length > 1 || milestones.includes('null')) {
      const hasNull = milestones.includes('null')
      data = data.filter((d) =>
        (hasNull && d.milestone_id == null) || (d.milestone_id != null && milestones.includes(d.milestone_id))
      )
    }
    if (labels.length > 0) {
      const labelIds = labels.map(Number)
      data = data.filter((d) => {
        const issueLabelIds = (d.labels ?? []).map((l) => l.id)
        if (labelMode === 'any') return labelIds.some((id) => issueLabelIds.includes(id))
        if (labelMode === 'all') return labelIds.every((id) => issueLabelIds.includes(id))
        if (labelMode === 'exclude_any') return !labelIds.some((id) => issueLabelIds.includes(id))
        if (labelMode === 'exclude_all') return !labelIds.every((id) => issueLabelIds.includes(id))
        return true
      })
    }
    return data
  }, [issuesQuery.data, status, priority, assignees, projects, milestones, labels, labelMode])

  async function bulkPatch(patch: Record<string, unknown>) {
    const ids = Array.from(selectedIds)
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/issues/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
      )
    )
    queryClient.invalidateQueries({ queryKey: ['ws-issues', ws?.slug] })
  }

  async function bulkAddLabel(labelId: number) {
    const ids = Array.from(selectedIds)
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/workspaces/${ws!.slug}/issues/${id}/labels`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label_id: labelId }),
        })
      )
    )
    queryClient.invalidateQueries({ queryKey: ['ws-issues', ws?.slug] })
  }

  async function bulkDelete() {
    const ids = Array.from(selectedIds)
    const ok = await confirm({
      title: `Delete ${ids.length} ${ids.length === 1 ? 'issue' : 'issues'}?`,
      description: 'They will be moved to Trash. You can restore them later.',
      destructive: true,
      confirmLabel: `Move ${ids.length} ${ids.length === 1 ? 'issue' : 'issues'} to Trash`,
    })
    if (!ok) return
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/issues/${id}`, { method: 'DELETE' })
        )
      )
      toast.success(`Moved ${ids.length} ${ids.length === 1 ? 'issue' : 'issues'} to Trash`)
      setSelectedIds(new Set())
      queryClient.invalidateQueries({ queryKey: ['ws-issues', ws?.slug] })
    } catch {
      toast.error('Some issues could not be deleted')
    }
  }

  const STATUS_OPTIONS = ISSUE_STATUSES.map((s) => ({
    value: s.value,
    label: s.label,
    icon: <StatusIcon status={s.value} size={13} />,
  }))

  const PRIORITY_OPTIONS = ISSUE_PRIORITIES.map((p) => ({
    value: p.value,
    label: p.label,
    icon: <PriorityIcon priority={issuePriorityKey(p.value)} size={13} />,
  }))

  const ASSIGNEE_OPTIONS = [
    { value: '', label: 'Unassigned' },
    ...(members ?? []).map((m) => ({
      value: m.user_id,
      label: m.name ?? m.email,
      icon: <MemberAvatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={13} />,
    })),
  ]

  const MILESTONE_OPTIONS = [
    { value: '', label: 'No milestone' },
    ...(milestoneList ?? []).map((m) => ({ value: m.id, label: m.name })),
  ]

  const LABEL_OPTIONS = (labelList ?? []).map((l) => ({
    value: l.id,
    label: l.name,
    color: l.color,
  }))

  const bulkActions: BulkAction[] = [
    {
      key: 'status',
      label: 'Status',
      options: STATUS_OPTIONS,
      onSelect: async (v) => {
        const ok = await confirm({
          title: `Change status for ${selectedIds.size} ${selectedIds.size === 1 ? 'issue' : 'issues'}?`,
          description: `All selected issues will be set to the new status.`,
          confirmLabel: 'Apply',
        })
        if (!ok) return
        await bulkPatch({ status: v })
        toast.success(`Updated status on ${selectedIds.size} ${selectedIds.size === 1 ? 'issue' : 'issues'}`)
      },
    },
    {
      key: 'priority',
      label: 'Priority',
      options: PRIORITY_OPTIONS,
      onSelect: async (v) => {
        const ok = await confirm({
          title: `Change priority for ${selectedIds.size} ${selectedIds.size === 1 ? 'issue' : 'issues'}?`,
          description: `All selected issues will be set to the new priority.`,
          confirmLabel: 'Apply',
        })
        if (!ok) return
        await bulkPatch({ priority: Number(v) })
        toast.success(`Updated priority on ${selectedIds.size} ${selectedIds.size === 1 ? 'issue' : 'issues'}`)
      },
    },
    {
      key: 'assignee',
      label: 'Assignee',
      options: ASSIGNEE_OPTIONS,
      searchable: true,
      onSelect: async (v) => {
        const ok = await confirm({
          title: `Reassign ${selectedIds.size} ${selectedIds.size === 1 ? 'issue' : 'issues'}?`,
          description: `All selected issues will be assigned to the chosen member.`,
          confirmLabel: 'Apply',
        })
        if (!ok) return
        await bulkPatch({ assignee_id: v === '' ? null : Number(v) })
        toast.success(`Reassigned ${selectedIds.size} ${selectedIds.size === 1 ? 'issue' : 'issues'}`)
      },
    },
    {
      key: 'milestone',
      label: 'Milestone',
      options: MILESTONE_OPTIONS,
      onSelect: async (v) => {
        const ok = await confirm({
          title: `Update milestone for ${selectedIds.size} ${selectedIds.size === 1 ? 'issue' : 'issues'}?`,
          description: `All selected issues will be moved to the chosen milestone.`,
          confirmLabel: 'Apply',
        })
        if (!ok) return
        await bulkPatch({ milestone_id: v === '' ? null : Number(v) })
        toast.success(`Updated milestone on ${selectedIds.size} ${selectedIds.size === 1 ? 'issue' : 'issues'}`)
      },
    },
    ...(LABEL_OPTIONS.length > 0
      ? [
          {
            key: 'label',
            label: 'Add label',
            options: LABEL_OPTIONS,
            searchable: true,
            onSelect: async (v: string | number) => {
              const label = labelList?.find((l) => l.id === Number(v))
              const ok = await confirm({
                title: `Add label "${label?.name}" to ${selectedIds.size} ${selectedIds.size === 1 ? 'issue' : 'issues'}?`,
                description: `The label will be added without removing existing labels.`,
                confirmLabel: 'Add label',
              })
              if (!ok) return
              await bulkAddLabel(Number(v))
              toast.success(`Added label to ${selectedIds.size} ${selectedIds.size === 1 ? 'issue' : 'issues'}`)
            },
          },
        ]
      : []),
  ]

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2.5 border-b border-border bg-background/80 px-4 backdrop-blur">
        <span className="text-[15px] font-semibold">Issues</span>
        <span className="flex items-center justify-center rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium tabular-nums text-foreground/70 ring-1 ring-border/60">
          {filtered.length}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <button
            onClick={() => ws && createIssue.mutate()}
            disabled={createIssue.isPending || !ws}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            <Plus size={15} />
            New issue
          </button>
        </div>
      </header>


<div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search issues…" />
        <FilterBar>
          <MultiSelect
            label="Status"
            options={STATUSES.map((s) => ({
              value: s.value,
              label: s.label,
              icon: <StatusIcon status={s.value} size={15} />,
            }))}
            selected={status}
            onChange={setStatus}
          />
          <MultiSelect
            label="Priority"
            options={PRIORITIES.map((p) => ({
              value: p.value,
              label: p.label,
              icon: <PriorityIcon priority={issuePriorityKey(p.value)} size={15} />,
            }))}
            selected={priority}
            onChange={setPriority}
          />
          <MultiSelect
            label="Assignee"
            searchable
            options={[
              { value: 'unassigned', label: 'Unassigned' },
              ...(members ?? []).map((m) => ({
                value: m.user_id,
                label: m.name ?? m.email,
                icon: <MemberAvatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={15} />,
              })),
            ]}
            selected={assignees}
            onChange={setAssignees}
          />
          <MultiSelect
            label="Project"
            options={[
              { value: 'null', label: 'No project', icon: <span className="size-[15px] rounded-full border border-dashed border-muted-foreground/40" /> },
              ...(projectList ?? []).map((p) => ({
                value: p.id,
                label: p.name,
                icon: <ProjectIcon icon={p.icon} color={p.color} name={p.name} size={15} />,
              })),
            ]}
            selected={projects}
            onChange={setProjects}
          />
          <MultiSelect
            label="Milestone"
            options={[
              { value: 'null', label: 'No milestone', icon: <span className="size-[15px] rounded-full border border-dashed border-muted-foreground/40" /> },
              ...(milestoneList ?? []).map((m) => ({
                value: m.id,
                label: m.name,
                icon: <Target size={15} className="text-muted-foreground" />,
              })),
            ]}
            selected={milestones}
            onChange={setMilestones}
          />
          <LabelFilter
            options={(labelList ?? []).map((l) => ({ value: l.id, label: l.name, color: l.color }))}
            selected={labels}
            onChange={setLabels}
            mode={labelMode}
            onModeChange={setLabelMode}
          />
        </FilterBar>
      </div>

      {view === 'list' ? (
        <IssueListView
          issues={filtered}
          workspaceKey={ws?.key ?? ''}
          workspaceSlug={ws?.slug ?? ''}
          members={members ?? []}
          loading={issuesQuery.isLoading}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />
      ) : view === 'kanban' ? (
        <div className="p-4">
          <IssuesKanban issues={filtered} workspaceKey={ws?.key ?? ''} wsSlug={ws?.slug ?? ''} />
        </div>
      ) : (
        <div className="p-4">
          <IssuesTimeline issues={filtered} workspaceKey={ws?.key ?? ''} />
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

function LabelFilter({
  options,
  selected,
  onChange,
  mode,
  onModeChange,
}: {
  options: Array<{ value: number; label: string; color: string }>
  selected: Array<string | number>
  onChange: (v: Array<string | number>) => void
  mode: LabelFilterMode
  onModeChange: (m: LabelFilterMode) => void
}) {
  const [modeOpen, setModeOpen] = useState(false)
  const modeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!modeRef.current?.contains(e.target as Node)) setModeOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const currentModeLabel = LABEL_FILTER_MODES.find((m) => m.value === mode)?.label ?? 'include any of'

  return (
    <div className="flex items-center gap-0">
      <MultiSelect
        label="Label"
        options={options}
        selected={selected}
        onChange={onChange}
        buttonClassName={selected.length > 1 ? 'rounded-r-none' : undefined}
      />
      {selected.length > 1 && (
        <div ref={modeRef} className="relative">
          <button
            type="button"
            onClick={() => setModeOpen((v) => !v)}
            className="flex items-center gap-1 rounded-r-md border border-l-0 border-primary/40 bg-primary/10 px-2.5 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
          >
            {currentModeLabel}
            <ChevronDown size={11} />
          </button>
          {modeOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
              <ul className="py-1">
                {LABEL_FILTER_MODES.map((m) => (
                  <li key={m.value}>
                    <button
                      type="button"
                      onClick={() => { onModeChange(m.value); setModeOpen(false) }}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-secondary ${mode === m.value ? 'text-primary' : 'text-foreground/80'}`}
                    >
                      {m.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const STATUS_ORDER = ['in_progress', 'todo', 'backlog', 'done', 'cancelled']

function IssueListView({
  issues,
  workspaceKey,
  workspaceSlug,
  members,
  loading,
  selectedIds,
  onSelectionChange,
}: {
  issues: IssueRow[]
  workspaceKey: string
  workspaceSlug: string
  members: Member[]
  loading: boolean
  selectedIds: Set<number>
  onSelectionChange: (ids: Set<number>) => void
}) {
  const queryClient = useQueryClient()
  const [localIssues, setLocalIssues] = useState(issues)
  useEffect(() => { setLocalIssues(issues) }, [issues])

  const reorder = useMutation({
    mutationFn: async (input: { ids: number[]; status: string }) => {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/issues/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error('failed')
    },
    onError: () => {
      toast.error('Reorder failed — reverting')
      setLocalIssues(issues)
    },
  })

  function onDragEnd(result: DropResult) {
    if (!result.destination) return
    const fromGroup = result.source.droppableId
    const toGroup = result.destination.droppableId
    if (fromGroup !== toGroup) return // cross-status drag not supported in list view
    if (result.source.index === result.destination.index) return

    const groupItems = localIssues.filter((i) => i.status === fromGroup)
    const others = localIssues.filter((i) => i.status !== fromGroup)
    const moved = groupItems[result.source.index]
    const next = [...groupItems]
    next.splice(result.source.index, 1)
    next.splice(result.destination.index, 0, moved)
    setLocalIssues([...others, ...next])
    reorder.mutate({ ids: next.map((i) => i.id), status: fromGroup })
  }

  if (loading) {
    return (
      <div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="mx-6 my-2 h-10 animate-pulse rounded bg-secondary/40" />
        ))}
      </div>
    )
  }
  if (localIssues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-center">
        <CircleDot size={32} className="mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No issues match your filters.</p>
      </div>
    )
  }

  const anySelected = selectedIds.size > 0

  const extraStatuses = [...new Set(localIssues.map((i) => i.status))].filter(
    (s) => !STATUS_ORDER.includes(s)
  )
  const groups = [...STATUS_ORDER, ...extraStatuses]
    .map((s) => ({ status: s, items: localIssues.filter((i) => i.status === s) }))
    .filter((g) => g.items.length > 0)

  function toggleGroup(items: IssueRow[]) {
    const groupIds = items.map((i) => i.id)
    const allSelected = groupIds.every((id) => selectedIds.has(id))
    const next = new Set(selectedIds)
    if (allSelected) {
      groupIds.forEach((id) => next.delete(id))
    } else {
      groupIds.forEach((id) => next.add(id))
    }
    onSelectionChange(next)
  }

  function toggleItem(id: number, checked: boolean) {
    const next = new Set(selectedIds)
    if (checked) next.add(id)
    else next.delete(id)
    onSelectionChange(next)
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div>
        {groups.map((group) => {
          const groupIds = group.items.map((i) => i.id)
          const allGroupSelected = groupIds.length > 0 && groupIds.every((id) => selectedIds.has(id))
          const someGroupSelected = groupIds.some((id) => selectedIds.has(id))
          return (
            <section key={group.status}>
              <div className="group/header flex w-full items-center gap-2 border-b border-border bg-secondary/30 px-6 py-2">
                {/* Group checkbox */}
                <div
                  className="flex shrink-0 cursor-pointer items-center justify-center"
                  onClick={() => toggleGroup(group.items)}
                >
                  <div
                    className={`flex size-3.5 items-center justify-center rounded border transition-all ${
                      allGroupSelected
                        ? 'border-primary bg-primary'
                        : someGroupSelected
                          ? 'border-primary bg-primary/30'
                          : anySelected
                            ? 'border-border bg-background hover:border-primary/50'
                            : 'border-transparent bg-transparent group-hover/header:border-border'
                    }`}
                  >
                    {allGroupSelected ? (
                      <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                        <path d="M1.5 4.5L3.5 6.5L7.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary-foreground" />
                      </svg>
                    ) : someGroupSelected ? (
                      <svg width="9" height="2" viewBox="0 0 9 2" fill="none">
                        <path d="M1 1H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-primary" />
                      </svg>
                    ) : null}
                  </div>
                </div>
                <StatusIcon status={group.status} size={15} />
                <span className="text-[13px] font-semibold text-foreground/80">{issueStatusLabel(group.status)}</span>
                <span className="text-[13px] text-muted-foreground">{group.items.length}</span>
              </div>
              <Droppable droppableId={group.status}>
                {(provided) => (
                  <ul ref={provided.innerRef} {...provided.droppableProps}>
                    {group.items.map((i, idx) => (
                      <Draggable key={i.id} draggableId={String(i.id)} index={idx}>
                        {(p, s) => (
                          <IssueRowItem
                            issue={i}
                            workspaceKey={workspaceKey}
                            workspaceSlug={workspaceSlug}
                            members={members}
                            selected={selectedIds.has(i.id)}
                            anySelected={anySelected}
                            onToggle={(checked) => toggleItem(i.id, checked)}
                            draggableRef={p.innerRef}
                            draggableProps={p.draggableProps}
                            dragHandleProps={p.dragHandleProps}
                            isDragging={s.isDragging}
                          />
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </ul>
                )}
              </Droppable>
            </section>
          )
        })}
      </div>
    </DragDropContext>
  )
}

const STATUS_OPTIONS = ISSUE_STATUSES.map((s) => ({
  value: s.value,
  label: s.label,
  icon: <StatusIcon status={s.value} size={15} />,
}))

const PRIORITY_OPTIONS = ISSUE_PRIORITIES.map((p) => ({
  value: String(p.value),
  label: p.label,
  icon: <PriorityIcon priority={issuePriorityKey(p.value)} size={15} />,
}))

function IssueRowItem({
  issue,
  workspaceKey,
  workspaceSlug,
  members,
  selected,
  anySelected,
  onToggle,
  draggableRef,
  draggableProps,
  dragHandleProps,
  isDragging,
}: {
  issue: IssueRow
  workspaceKey: string
  workspaceSlug: string
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

  const patch = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ws-issues', workspaceSlug] })
    },
  })

  const assigneeOptions = [
    { value: '', label: 'Unassigned', icon: <span className="flex size-[15px] items-center justify-center rounded-full bg-neutral-700 text-[7px] font-semibold tracking-tight text-neutral-400">UA</span> },
    ...members.map((m) => ({
      value: String(m.user_id),
      label: m.name ?? m.email,
      icon: <MemberAvatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={15} />,
    })),
  ]

  const currentAssigneeId = issue.assignee_id ? String(issue.assignee_id) : ''

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
          router.push(`/dashboard/issues/${issue.id}`)
        }}
        className={`group flex h-11 cursor-pointer items-center gap-2.5 border-b border-border/50 px-3 pl-2 transition-colors hover:bg-secondary/40 ${selected ? 'bg-primary/5' : ''}`}
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
          className="size-4"
        />

        {/* Priority — inline editable, icon-only */}
        <div onClick={stop} className="shrink-0">
          <PropertySelect
            value={String(issue.priority)}
            options={PRIORITY_OPTIONS}
            onChange={(v) => patch.mutate({ priority: parseInt(v) })}
            buttonClassName="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:bg-secondary"
            iconOnly
            noSearch
          />
        </div>
        <span className="w-[4.5rem] shrink-0 font-mono text-xs tabular-nums text-muted-foreground/70">
          {issue.seq != null ? `${workspaceKey}-${issue.seq}` : `#${issue.id}`}
        </span>
        {/* Status — inline editable, icon-only */}
        <div onClick={stop} className="shrink-0">
          <PropertySelect
            value={issue.status}
            options={STATUS_OPTIONS}
            onChange={(v) => patch.mutate({ status: v })}
            buttonClassName="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:bg-secondary"
            iconOnly
            noSearch
          />
        </div>
        <span className="flex-1 truncate text-sm">{issue.title}</span>
        {(issue.labels ?? []).length > 0 && (
          <span className="hidden shrink-0 items-center gap-1 sm:flex">
            {(issue.labels ?? []).map((l) => (
              <span
                key={l.id}
                title={l.name}
                className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none"
                style={{ borderColor: l.color + '60', color: l.color, backgroundColor: l.color + '18' }}
              >
                <span
                  className="inline-block size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: l.color }}
                />
                {l.name}
              </span>
            ))}
          </span>
        )}
        {issue.project_name ? (
          <span className="hidden max-w-[120px] shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
            <ProjectIcon icon={issue.project_icon} color={issue.project_color} name={issue.project_name} size={15} />
            <span className="truncate">{issue.project_name}</span>
          </span>
        ) : null}
        {/* Assignee — inline editable, avatar-only */}
        <div onClick={stop} className="shrink-0">
          <PropertySelect
            value={currentAssigneeId}
            options={assigneeOptions}
            onChange={(v) => patch.mutate({ assignee_id: v ? parseInt(v) : null })}
            buttonClassName="flex items-center justify-center rounded p-0.5 hover:bg-secondary"
            iconOnly
            noSearch
            align="right"
          />
        </div>
        <span className="w-10 shrink-0 text-right text-xs text-muted-foreground" suppressHydrationWarning>
          {format(new Date(issue.created_at), 'MMM d')}
        </span>
      </div>
    </li>
  )
}
