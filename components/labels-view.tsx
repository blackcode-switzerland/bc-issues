'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Edit3, Plus, Tag, Trash2, X } from 'lucide-react'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { useConfirm } from '@/components/ui/confirm-dialog'

interface LabelRow {
  id: number
  name: string
  color: string
  description: string | null
  issue_count: number
  created_at: string
}

const PRESET_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#5e6ad2',
  '#8a8f98',
  '#a855f7',
  '#ec4899',
  '#6b7280',
]

export function LabelsView() {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const { data: ws } = useActiveWorkspace()
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)

  const labels = useQuery({
    queryKey: ['ws-labels-listing', ws?.slug],
    enabled: !!ws,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/labels`)
      if (!res.ok) throw new Error('failed')
      const j = await res.json()
      return j.data as LabelRow[]
    },
  })

  const create = useMutation({
    mutationFn: async (input: { name: string; color: string; description: string | null }) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/labels`, {
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
      toast.success('Label created')
      setCreating(false)
      queryClient.invalidateQueries({ queryKey: ['ws-labels-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-labels'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const update = useMutation({
    mutationFn: async (input: { id: number; name?: string; color?: string; description?: string | null }) => {
      const { id, ...patch } = input
      const res = await fetch(`/api/workspaces/${ws!.slug}/labels/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'failed')
      }
    },
    onSuccess: () => {
      toast.success('Label updated')
      setEditingId(null)
      queryClient.invalidateQueries({ queryKey: ['ws-labels-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-labels'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/labels/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      toast.success('Label deleted')
      queryClient.invalidateQueries({ queryKey: ['ws-labels-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-labels'] })
    },
    onError: () => toast.error('Could not delete label'),
  })

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-11 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur">
        <h1 className="text-[13px] font-medium">Labels</h1>
        <span className="text-xs text-muted-foreground">{labels.data?.length ?? 0}</span>
        <button
          onClick={() => setCreating(true)}
          className="ml-auto flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus size={12} />
          New label
        </button>
      </header>

      {creating ? (
        <div className="border-b border-border px-6 py-4">
          <LabelForm onSubmit={(v) => create.mutate(v)} onCancel={() => setCreating(false)} />
        </div>
      ) : null}

      {labels.isLoading ? (
        <p className="px-6 py-4 text-sm text-muted-foreground">Loading…</p>
      ) : !labels.data?.length ? (
        <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
          <Tag size={28} className="mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No labels yet. Create one to tag issues.</p>
        </div>
      ) : (
        <ul>
          {labels.data.map((l) =>
            editingId === l.id ? (
              <li key={l.id} className="border-b border-border px-6 py-4">
                <LabelForm
                  initial={l}
                  onSubmit={(v) => update.mutate({ id: l.id, ...v })}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li
                key={l.id}
                className="group flex items-center gap-3 px-6 py-2.5 transition-colors hover:bg-secondary/40"
              >
                <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
                <span className="shrink-0 text-[13px]">{l.name}</span>
                <div className="min-w-0 flex-1">
                  {l.description ? (
                    <p className="truncate text-xs text-muted-foreground">{l.description}</p>
                  ) : null}
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {l.issue_count} {l.issue_count === 1 ? 'issue' : 'issues'}
                </span>
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => setEditingId(l.id)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
                    title="Edit"
                  >
                    <Edit3 size={14} />
                  </button>
                  <button
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: `Delete label "${l.name}"?`,
                          description: 'It will be removed from all issues.',
                          destructive: true,
                          confirmLabel: 'Delete',
                        }))
                      )
                        return
                      remove.mutate(l.id)
                    }}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  )
}

function LabelForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: { name: string; color: string; description: string | null }
  onSubmit: (v: { name: string; color: string; description: string | null }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? PRESET_COLORS[5])
  const [description, setDescription] = useState(initial?.description ?? '')

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        onSubmit({ name: name.trim(), color, description: description.trim() || null })
      }}
    >
      <div className="mb-3 flex items-center gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Label name"
          maxLength={50}
          className="flex-1 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
        >
          <X size={14} />
        </button>
      </div>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Color</span>
        <div className="flex flex-wrap gap-1">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`size-6 rounded-full ${color === c ? 'ring-2 ring-ring ring-offset-2 ring-offset-background' : ''}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
      />
    </form>
  )
}
