'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { CircleDot, Plus } from 'lucide-react'
import { useActiveWorkspace } from './use-active-workspace'
import { FilterBar, MultiSelect, SearchInput, ViewToggle, type ViewMode } from './filter-bar'
import { IssuesKanban } from './issues-kanban'
import { IssuesTimeline } from './issues-timeline'
import { IssueCreateModal } from '../issue-create-modal'
import { StatusIcon, PriorityIcon, issuePriorityKey } from '@/components/ui/work-item-icons'
import { MemberAvatar } from '@/components/ui/member-avatar'
import { ISSUE_PRIORITIES, ISSUE_STATUSES, issueStatusLabel } from '@/lib/work-items'

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

const STATUSES = ISSUE_STATUSES.map((s) => ({ value: s.value, label: s.label }))
const PRIORITIES = ISSUE_PRIORITIES.map((p) => ({ value: p.value, label: p.label }))

export function IssuesListing() {
  const { data: ws } = useActiveWorkspace()
  const [view, setView] = useState<ViewMode>('list')
  const [showCreate, setShowCreate] = useState(false)
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
    <div>
      <header className="sticky top-0 z-10 flex h-11 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur">
        <span className="text-[13px] font-medium">Issues</span>
        <span className="text-xs text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? 'issue' : 'issues'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus size={14} />
            New issue
          </button>
        </div>
      </header>

      <IssueCreateModal open={showCreate} onClose={() => setShowCreate(false)} />

      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search issues…" />
        <FilterBar>
          <MultiSelect
            label="Status"
            options={STATUSES.map((s) => ({
              value: s.value,
              label: s.label,
              icon: <StatusIcon status={s.value} size={14} />,
            }))}
            selected={status}
            onChange={setStatus}
          />
          <MultiSelect
            label="Priority"
            options={PRIORITIES.map((p) => ({
              value: p.value,
              label: p.label,
              icon: <PriorityIcon priority={issuePriorityKey(p.value)} size={14} />,
            }))}
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
        <div className="p-4">
          <IssuesKanban issues={filtered} workspaceKey={ws?.key ?? ''} />
        </div>
      ) : (
        <div className="p-4">
          <IssuesTimeline issues={filtered} workspaceKey={ws?.key ?? ''} />
        </div>
      )}
    </div>
  )
}

const STATUS_ORDER = ['in_progress', 'todo', 'backlog', 'done', 'cancelled']

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
    return (
      <div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="mx-6 my-2 h-10 animate-pulse rounded bg-secondary/40" />
        ))}
      </div>
    )
  }
  if (issues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-center">
        <CircleDot size={32} className="mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No issues match your filters.</p>
      </div>
    )
  }

  // Display order: in_progress, todo, backlog, done, cancelled; any unknown
  // statuses are appended as their own groups at the end.
  const extraStatuses = [...new Set(issues.map((i) => i.status))].filter(
    (s) => !STATUS_ORDER.includes(s)
  )
  const groups = [...STATUS_ORDER, ...extraStatuses]
    .map((s) => ({ status: s, items: issues.filter((i) => i.status === s) }))
    .filter((g) => g.items.length > 0)

  return (
    <div>
      {groups.map((group) => (
        <section key={group.status}>
          <div className="flex w-full items-center gap-2 bg-secondary/40 px-6 py-1.5">
            <StatusIcon status={group.status} size={14} />
            <span className="text-[13px] font-medium">{issueStatusLabel(group.status)}</span>
            <span className="text-xs text-muted-foreground">{group.items.length}</span>
          </div>
          <ul>
            {group.items.map((i) => (
              <li key={i.id}>
                <Link
                  href={`/dashboard/issues/${i.id}`}
                  prefetch={false}
                  className="flex h-10 items-center gap-3 px-6 transition-colors hover:bg-secondary/40"
                >
                  <PriorityIcon priority={issuePriorityKey(i.priority)} size={14} />
                  <span className="w-16 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {i.seq != null ? `${workspaceKey}-${i.seq}` : `#${i.id}`}
                  </span>
                  <StatusIcon status={i.status} size={14} />
                  <span className="flex-1 truncate text-[13px]">{i.title}</span>
                  {i.project_name ? (
                    <span className="hidden rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground sm:inline-flex">
                      {i.project_name}
                    </span>
                  ) : null}
                  {i.assignee_name || i.assignee_email ? (
                    <MemberAvatar name={i.assignee_name} email={i.assignee_email} size={18} />
                  ) : (
                    <span className="size-[18px] shrink-0 rounded-full border border-dashed border-border" />
                  )}
                  <span className="w-12 shrink-0 text-right text-[11px] text-muted-foreground" suppressHydrationWarning>
                    {format(new Date(i.updated_at), 'MMM d')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
