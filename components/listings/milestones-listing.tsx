'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { format, isPast, isToday } from 'date-fns'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Target } from 'lucide-react'
import { toast } from 'sonner'
import { useActiveWorkspace } from './use-active-workspace'
import { FilterBar, MultiSelect, SearchInput } from './filter-bar'

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
  const queryClient = useQueryClient()
  const { data: ws } = useActiveWorkspace()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<Array<string | number>>([])
  const [projectIds, setProjectIds] = useState<Array<string | number>>([])
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newProjectId, setNewProjectId] = useState<string>('')

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

  const create = useMutation({
    mutationFn: async (input: { name: string; project_id: number | null }) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'failed')
      }
    },
    onSuccess: () => {
      toast.success('Milestone created')
      setCreating(false)
      setNewName('')
      setNewProjectId('')
      queryClient.invalidateQueries({ queryKey: ['ws-milestones-listing'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const projectOptions = [
    { value: 'null', label: 'No project (standalone)' },
    ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name })),
  ]

  return (
    <div className="p-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Milestones</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? 'milestone' : 'milestones'}
            {ws ? ` in ${ws.name}` : ''}
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus size={14} />
          New milestone
        </button>
      </header>

      {creating ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!newName.trim()) return
            create.mutate({
              name: newName.trim(),
              project_id: newProjectId ? parseInt(newProjectId) : null,
            })
          }}
          className="mb-4 flex flex-wrap gap-2 rounded-lg border border-border bg-card/30 p-3"
        >
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Milestone name"
            maxLength={120}
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
          <select
            value={newProjectId}
            onChange={(e) => setNewProjectId(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          >
            <option value="">No project (standalone)</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false)
              setNewName('')
              setNewProjectId('')
            }}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary"
          >
            Cancel
          </button>
        </form>
      ) : null}

      <div className="mb-4 flex flex-col gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search milestones…" />
        <FilterBar>
          <MultiSelect label="Status" options={STATUSES} selected={status} onChange={setStatus} />
          <MultiSelect
            label="Project"
            options={projectOptions}
            selected={projectIds}
            onChange={setProjectIds}
          />
        </FilterBar>
      </div>

      {milestones.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card/30 p-16 text-center">
          <Target size={32} className="mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No milestones match your filters.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card/30">
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
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary/50"
                >
                  <Target size={16} className="shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {m.project_name ?? 'Standalone'}
                      {m.status ? ` · ${m.status}` : ''}
                      {due ? (
                        <>
                          {' · '}
                          <span className={overdue ? 'text-red-400' : ''}>
                            due {format(due, 'MMM d, yyyy')}
                          </span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="hidden w-32 shrink-0 sm:block">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>
                        {done}/{total}
                      </span>
                      <span>{pct}%</span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
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
