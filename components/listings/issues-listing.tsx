'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { CircleDot, Clock, MessageSquare, Paperclip, Plus, Users } from 'lucide-react'
import { useActiveWorkspace } from './use-active-workspace'
import { FilterBar, MultiSelect, SearchInput, ViewToggle, type ViewMode } from './filter-bar'
import { LabelChip } from './labels-pill'
import { IssuesKanban } from './issues-kanban'
import { IssuesTimeline } from './issues-timeline'

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
  comment_count: number
  attachment_count: number
  start_date: string | null
  due_date: string | null
  created_at: string
  updated_at: string
}

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
}

interface LabelRow {
  id: number
  name: string
  color: string
}

const STATUSES = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'in_review', label: 'In review' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
]

const STATUS_COLORS: Record<string, string> = {
  backlog: 'text-zinc-500 bg-zinc-500/10',
  todo: 'text-zinc-300 bg-zinc-500/10',
  in_progress: 'text-blue-400 bg-blue-500/10',
  blocked: 'text-red-400 bg-red-500/10',
  in_review: 'text-purple-400 bg-purple-500/10',
  done: 'text-emerald-400 bg-emerald-500/10',
  cancelled: 'text-zinc-500 bg-zinc-500/10 line-through',
}

const PRIORITIES = [
  { value: 1, label: 'Urgent', color: 'text-red-400' },
  { value: 2, label: 'High', color: 'text-amber-400' },
  { value: 3, label: 'Medium', color: 'text-blue-400' },
  { value: 4, label: 'Low', color: 'text-zinc-400' },
  { value: 5, label: 'None', color: 'text-zinc-500' },
]

function priorityLabel(p: number) {
  return PRIORITIES.find((x) => x.value === p)?.label ?? '—'
}

function priorityColor(p: number) {
  return PRIORITIES.find((x) => x.value === p)?.color ?? 'text-muted-foreground'
}

export function IssuesListing() {
  const { data: ws } = useActiveWorkspace()
  const [view, setView] = useState<ViewMode>('list')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<Array<string | number>>([])
  const [priority, setPriority] = useState<Array<string | number>>([])
  const [assignees, setAssignees] = useState<Array<string | number>>([])
  const [projects, setProjects] = useState<Array<string | number>>([])
  const [milestones, setMilestones] = useState<Array<string | number>>([])
  const [labels, setLabels] = useState<Array<string | number>>([])

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

  // Issues query — server side handles status/priority/assignee/project/milestone/search.
  // Label filtering is client-side for now since we don't yet have per-issue label rows in the page response.
  const issuesQuery = useQuery({
    queryKey: ['ws-issues', ws?.slug, { search, status, priority, assignees, projects, milestones }],
    enabled: !!ws,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (status.length === 1) params.set('status', String(status[0]))
      if (priority.length === 1) params.set('priority', String(priority[0]))
      if (assignees.length === 1) params.set('assignee_id', String(assignees[0]))
      if (projects.length === 1) params.set('project_id', String(projects[0]))
      if (milestones.length === 1) params.set('milestone_id', String(milestones[0]))
      params.set('limit', '200')
      const res = await fetch(`/api/workspaces/${ws!.slug}/issues?${params}`)
      if (!res.ok) throw new Error('failed')
      const j = await res.json()
      return j.data as IssueRow[]
    },
  })

  const filtered = useMemo(() => {
    let data = issuesQuery.data ?? []
    // Multi-select client-side narrow where server only honored single
    if (status.length > 1) data = data.filter((d) => status.includes(d.status))
    if (priority.length > 1) data = data.filter((d) => priority.includes(d.priority))
    if (assignees.length > 1)
      data = data.filter((d) => d.assignee_id != null && assignees.includes(d.assignee_id))
    if (projects.length > 1)
      data = data.filter((d) => d.project_id != null && projects.includes(d.project_id))
    if (milestones.length > 1)
      data = data.filter((d) => d.milestone_id != null && milestones.includes(d.milestone_id))
    return data
  }, [issuesQuery.data, status, priority, assignees, projects, milestones])

  return (
    <div className="p-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Issues</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? 'issue' : 'issues'}
            {ws ? ` in ${ws.name}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <Link
            href="/dashboard/issues/new"
            className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus size={14} />
            New issue
          </Link>
        </div>
      </header>

      <div className="mb-4 flex flex-col gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search issues…" />
        <FilterBar>
          <MultiSelect
            label="Status"
            options={STATUSES}
            selected={status}
            onChange={setStatus}
          />
          <MultiSelect
            label="Priority"
            options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
            selected={priority}
            onChange={setPriority}
          />
          <MultiSelect
            label="Assignee"
            options={(members ?? []).map((m) => ({
              value: m.user_id,
              label: m.name ?? m.email,
            }))}
            selected={assignees}
            onChange={setAssignees}
          />
          <MultiSelect
            label="Project"
            options={(projectList ?? []).map((p) => ({ value: p.id, label: p.name }))}
            selected={projects}
            onChange={setProjects}
          />
          <MultiSelect
            label="Milestone"
            options={(milestoneList ?? []).map((m) => ({ value: m.id, label: m.name }))}
            selected={milestones}
            onChange={setMilestones}
          />
          <MultiSelect
            label="Label"
            options={(labelList ?? []).map((l) => ({
              value: l.id,
              label: l.name,
              color: l.color,
            }))}
            selected={labels}
            onChange={setLabels}
          />
        </FilterBar>
      </div>

      {view === 'list' ? (
        <IssueListView issues={filtered} workspaceKey={ws?.key ?? ''} loading={issuesQuery.isLoading} />
      ) : view === 'kanban' ? (
        <IssuesKanban issues={filtered} workspaceKey={ws?.key ?? ''} />
      ) : (
        <IssuesTimeline issues={filtered} workspaceKey={ws?.key ?? ''} />
      )}
    </div>
  )
}

function IssueListView({
  issues,
  workspaceKey,
  loading,
}: {
  issues: IssueRow[]
  workspaceKey: string
  loading: boolean
}) {
  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }
  if (issues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card/30 p-16 text-center">
        <CircleDot size={32} className="mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No issues match your filters.</p>
      </div>
    )
  }
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card/30">
      {issues.map((i) => (
        <li key={i.id}>
          <Link
            href={`/dashboard/issues/${i.id}`}
            prefetch={false}
            className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-secondary/50"
          >
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground w-20 shrink-0">
              {i.seq != null ? `${workspaceKey}-${i.seq}` : `#${i.id}`}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${STATUS_COLORS[i.status] ?? ''}`}>
              {i.status.replace('_', ' ')}
            </span>
            <span className={`text-[10px] font-medium ${priorityColor(i.priority)}`}>
              {priorityLabel(i.priority)}
            </span>
            <span className="flex-1 truncate text-sm">{i.title}</span>
            {i.project_name ? (
              <span className="hidden text-[10px] text-muted-foreground sm:inline">{i.project_name}</span>
            ) : null}
            {i.milestone_name ? (
              <span className="hidden text-[10px] text-muted-foreground sm:inline">· {i.milestone_name}</span>
            ) : null}
            <span className="hidden items-center gap-2 text-[11px] text-muted-foreground md:flex">
              {i.comment_count ? (
                <span className="inline-flex items-center gap-0.5">
                  <MessageSquare size={11} />
                  {i.comment_count}
                </span>
              ) : null}
              {i.attachment_count ? (
                <span className="inline-flex items-center gap-0.5">
                  <Paperclip size={11} />
                  {i.attachment_count}
                </span>
              ) : null}
            </span>
            {i.assignee_name ? (
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
                {i.assignee_name[0].toUpperCase()}
              </span>
            ) : (
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
                <Users size={10} />
              </span>
            )}
            <span className="hidden w-20 shrink-0 text-right text-[11px] text-muted-foreground sm:inline" suppressHydrationWarning>
              {formatDistanceToNow(new Date(i.updated_at), { addSuffix: true })}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

void Clock
void LabelChip
