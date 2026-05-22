'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Folder, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useActiveWorkspace } from './use-active-workspace'
import { FilterBar, MultiSelect, SearchInput } from './filter-bar'

interface ProjectRow {
  id: number
  workspace_id: number
  name: string
  description: string | null
  status: string
  color: string | null
  issue_count: number
  open_issues: number
  updated_at: string
}

const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'completed', label: 'Completed' },
]

export function ProjectsListing() {
  const queryClient = useQueryClient()
  const { data: ws } = useActiveWorkspace()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<Array<string | number>>([])
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

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

  const create = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Project created')
      setNewName('')
      setCreating(false)
      queryClient.invalidateQueries({ queryKey: ['ws-projects-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-projects'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

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
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus size={14} />
          New project
        </button>
      </header>

      {creating ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (newName.trim()) create.mutate(newName.trim())
          }}
          className="mb-4 flex gap-2 rounded-lg border border-border bg-card/30 p-3"
        >
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Project name"
            maxLength={100}
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
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
            }}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary"
          >
            Cancel
          </button>
        </form>
      ) : null}

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
                    <span
                      className="inline-block size-3 rounded-sm"
                      style={{ backgroundColor: p.color ?? '#3B82F6' }}
                    />
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
