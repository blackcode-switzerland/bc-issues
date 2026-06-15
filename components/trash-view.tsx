'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import { Folder, ListChecks, RotateCcw, Target, Trash2 } from 'lucide-react'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { BulkActionBar, RowCheckbox } from './listings/bulk-action-bar'
import { MemberAvatar } from '@/components/ui/member-avatar'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  RestoreConflictDialog,
  type RestoreConflict,
  type RestoreResolution,
} from '@/components/ui/restore-conflict-dialog'
import { TrashSkeletonRow, AnimatePresence, motion } from '@/components/ui/motion'

type TrashType = 'issue' | 'project' | 'milestone'

interface TrashItem {
  type: TrashType
  id: number
  title: string
  seq: number | null
  status: string | null
  deleted_at: string
  deleted_by_id: number | null
  deleted_by_name: string | null
  batch_id: number | null
  batch_mode: 'cascade' | 'detach' | null
  batch_root_type: TrashType | null
  batch_root_id: number | null
  project_id: number | null
  milestone_id: number | null
}

interface EntityRef {
  type: TrashType
  id: number
}

const TYPE_TABS: { value: TrashType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'issue', label: 'Issues' },
  { value: 'project', label: 'Projects' },
  { value: 'milestone', label: 'Milestones' },
]

function TypeIcon({ type, size = 15 }: { type: TrashType; size?: number }) {
  if (type === 'project') return <Folder size={size} className="text-muted-foreground" />
  if (type === 'milestone') return <Target size={size} className="text-muted-foreground" />
  return <ListChecks size={size} className="text-muted-foreground" />
}

const keyOf = (i: { type: TrashType; id: number }) => `${i.type}:${i.id}`

export function TrashView() {
  const { data: ws } = useActiveWorkspace()
  const slug = ws?.slug
  const isOwner = ws?.member_role === 'owner'
  const queryClient = useQueryClient()
  const { confirm, prompt } = useConfirm()

  const [tab, setTab] = useState<TrashType | 'all'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [conflictState, setConflictState] = useState<{
    conflicts: RestoreConflict[]
    refs: EntityRef[]
  } | null>(null)

  const trash = useQuery({
    queryKey: ['ws-trash', slug, tab],
    enabled: !!slug,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<TrashItem[]> => {
      const q = tab === 'all' ? '' : `?type=${tab}`
      const res = await fetch(`/api/workspaces/${slug}/trash${q}`)
      if (!res.ok) throw new Error('failed')
      const { data } = await res.json()
      return data as TrashItem[]
    },
  })

  const items = trash.data ?? []

  // Invalidate everything a restore/purge could affect so active views refresh.
  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['ws-trash', slug] })
    queryClient.invalidateQueries({ queryKey: ['ws-issues'] })
    queryClient.invalidateQueries({ queryKey: ['project-issues'] })
    queryClient.invalidateQueries({ queryKey: ['milestone-issues'] })
    queryClient.invalidateQueries({ queryKey: ['ws-projects-listing'] })
    queryClient.invalidateQueries({ queryKey: ['ws-projects'] })
    queryClient.invalidateQueries({ queryKey: ['ws-milestones-listing'] })
    queryClient.invalidateQueries({ queryKey: ['ws-milestones'] })
    queryClient.invalidateQueries({ queryKey: ['project-milestones'] })
    queryClient.invalidateQueries({ queryKey: ['sidebar-counts', slug] })
    setSelected(new Set())
  }

  // Group items by batch; batches with >1 member render as a group card.
  const groups = useMemo(() => {
    const byBatch = new Map<number, TrashItem[]>()
    const singles: TrashItem[] = []
    for (const it of items) {
      if (it.batch_id == null) {
        singles.push(it)
        continue
      }
      const arr = byBatch.get(it.batch_id) ?? []
      arr.push(it)
      byBatch.set(it.batch_id, arr)
    }
    const result: Array<{ batchId: number | null; items: TrashItem[] }> = []
    for (const [batchId, arr] of byBatch) {
      if (arr.length > 1) result.push({ batchId, items: arr })
      else singles.push(...arr)
    }
    for (const s of singles) result.push({ batchId: null, items: [s] })
    // Sort by most-recent deletion in the group.
    result.sort((a, b) => {
      const ax = Math.max(...a.items.map((i) => Date.parse(i.deleted_at)))
      const bx = Math.max(...b.items.map((i) => Date.parse(i.deleted_at)))
      return bx - ax
    })
    return result
  }, [items])

  const restoreMut = useMutation({
    mutationFn: async (payload: {
      refs?: EntityRef[]
      batch_id?: number
      resolutions?: Record<string, RestoreResolution>
    }) => {
      const body: Record<string, unknown> = {}
      if (payload.batch_id != null) body.batch_id = payload.batch_id
      if (payload.refs) body.items = payload.refs
      if (payload.resolutions) body.resolutions = payload.resolutions
      const res = await fetch(`/api/workspaces/${slug}/trash/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: (r) => {
      toast.success(`Restored ${r.count ?? ''}`.trim())
      setConflictState(null)
      invalidateAll()
    },
    onError: () => toast.error('Could not restore'),
  })

  // Restore entry point: dry-run for conflicts first, then commit.
  async function startRestore(refs: EntityRef[], batchId?: number) {
    const body: Record<string, unknown> = { dry_run: true }
    if (batchId != null) body.batch_id = batchId
    else body.items = refs
    const res = await fetch(`/api/workspaces/${slug}/trash/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      toast.error('Could not restore')
      return
    }
    const preview = (await res.json()) as { conflicts: RestoreConflict[] }
    if (preview.conflicts && preview.conflicts.length > 0) {
      setConflictState({ conflicts: preview.conflicts, refs: batchId != null ? [] : refs })
      return
    }
    if (batchId != null) restoreMut.mutate({ batch_id: batchId })
    else restoreMut.mutate({ refs })
  }

  const purgeMut = useMutation({
    mutationFn: async (payload: { refs?: EntityRef[]; batch_id?: number }) => {
      const body: Record<string, unknown> = {}
      if (payload.batch_id != null) body.batch_id = payload.batch_id
      if (payload.refs) body.items = payload.refs
      const res = await fetch(`/api/workspaces/${slug}/trash/purge`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: (r) => {
      toast.success(`Permanently deleted ${r.purged ?? ''}`.trim())
      invalidateAll()
    },
    onError: () => toast.error('Could not delete'),
  })

  async function startPurge(refs: EntityRef[], batchId?: number, label?: string) {
    const ok = await confirm({
      title: `Permanently delete ${label ?? 'selected items'}?`,
      description: 'This cannot be undone. Everything is removed forever.',
      destructive: true,
      confirmLabel: 'Delete forever',
    })
    if (!ok) return
    if (batchId != null) purgeMut.mutate({ batch_id: batchId })
    else purgeMut.mutate({ refs })
  }

  async function emptyBin() {
    const typed = await prompt({
      title: 'Empty the Trash?',
      description: 'Every item below is permanently deleted. This cannot be undone.',
      destructive: true,
      confirmLabel: 'Empty Trash',
      inputLabel: 'Type EMPTY to confirm',
      placeholder: 'EMPTY',
      requireMatch: 'EMPTY',
    })
    if (typed !== 'EMPTY') return
    const res = await fetch(`/api/workspaces/${slug}/trash/empty`, { method: 'POST' })
    if (!res.ok) {
      toast.error('Could not empty Trash')
      return
    }
    const r = await res.json()
    toast.success(`Emptied Trash (${r.purged} items)`)
    invalidateAll()
  }

  function toggle(item: TrashItem) {
    const k = keyOf(item)
    const next = new Set(selected)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setSelected(next)
  }

  const selectedRefs: EntityRef[] = useMemo(
    () =>
      items
        .filter((i) => selected.has(keyOf(i)))
        .map((i) => ({ type: i.type, id: i.id })),
    [items, selected]
  )

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Trash</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Deleted issues, projects, and milestones. Restore them, or remove them for good.
          </p>
        </div>
        {isOwner && items.length > 0 ? (
          <button
            onClick={emptyBin}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
          >
            Empty Trash
          </button>
        ) : null}
      </header>

      <div className="mb-4 flex gap-1 border-b border-border">
        {TYPE_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.value
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {trash.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <TrashSkeletonRow key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="flex flex-col items-center justify-center py-20 text-center"
        >
          <div className="mb-4 rounded-xl border border-border bg-secondary/40 p-5 text-muted-foreground/50">
            <Trash2 size={28} />
          </div>
          <p className="text-[15px] font-semibold text-foreground/60">Trash is empty</p>
          <p className="mt-1 text-[13px] text-muted-foreground">Deleted items appear here. You can restore them or remove them permanently.</p>
        </motion.div>
      ) : (
        <motion.div
          className="space-y-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          <AnimatePresence initial={false}>
          {groups.map((g) =>
            g.batchId != null ? (
              <motion.div
                key={`batch-${g.batchId}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
                transition={{ duration: 0.2 }}
              >
                <BatchCard
                  batchId={g.batchId}
                  items={g.items}
                  selected={selected}
                  onToggle={toggle}
                  onRestore={() => startRestore([], g.batchId!)}
                  onPurge={
                    isOwner
                      ? () => startPurge([], g.batchId!, `this group of ${g.items.length} items`)
                      : undefined
                  }
                />
              </motion.div>
            ) : (
              <motion.div
                key={keyOf(g.items[0])}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
                transition={{ duration: 0.2 }}
              >
                <TrashRow
                  item={g.items[0]}
                  selected={selected.has(keyOf(g.items[0]))}
                  anySelected={selected.size > 0}
                  onToggle={() => toggle(g.items[0])}
                  onRestore={() => startRestore([{ type: g.items[0].type, id: g.items[0].id }])}
                  onPurge={
                    isOwner
                      ? () =>
                          startPurge(
                            [{ type: g.items[0].type, id: g.items[0].id }],
                            undefined,
                            `"${g.items[0].title}"`
                          )
                      : undefined
                  }
                />
              </motion.div>
            )
          )}
          </AnimatePresence>
        </motion.div>
      )}

      <BulkActionBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
        actions={[
          {
            key: 'restore',
            label: 'Restore',
            icon: <RotateCcw size={15} />,
            options: [{ value: 'restore', label: 'Restore selected' }],
            onSelect: () => startRestore(selectedRefs),
          },
        ]}
        onDelete={isOwner ? () => startPurge(selectedRefs, undefined, `${selected.size} items`) : undefined}
        deleteLabel="Delete forever"
      />

      <RestoreConflictDialog
        open={!!conflictState}
        conflicts={conflictState?.conflicts ?? []}
        busy={restoreMut.isPending}
        onCancel={() => setConflictState(null)}
        onConfirm={(resolutions) => {
          if (!conflictState) return
          restoreMut.mutate({ refs: conflictState.refs, resolutions })
        }}
      />
    </div>
  )
}

function ItemMeta({ item }: { item: TrashItem }) {
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>deleted {formatDistanceToNow(new Date(item.deleted_at), { addSuffix: true })}</span>
      {item.deleted_by_name ? (
        <span className="flex items-center gap-1">
          by
          <MemberAvatar name={item.deleted_by_name} size={14} />
          {item.deleted_by_name}
        </span>
      ) : null}
    </span>
  )
}

function TrashRow({
  item,
  selected,
  anySelected,
  onToggle,
  onRestore,
  onPurge,
}: {
  item: TrashItem
  selected: boolean
  anySelected: boolean
  onToggle: () => void
  onRestore: () => void
  onPurge?: () => void
}) {
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-secondary/30">
      <RowCheckbox checked={selected} onChange={onToggle} anySelected={anySelected} />
      <TypeIcon type={item.type} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
        <ItemMeta item={item} />
      </div>
      <RowActions onRestore={onRestore} onPurge={onPurge} />
    </div>
  )
}

function BatchCard({
  batchId,
  items,
  selected,
  onToggle,
  onRestore,
  onPurge,
}: {
  batchId: number
  items: TrashItem[]
  selected: Set<string>
  onToggle: (i: TrashItem) => void
  onRestore: () => void
  onPurge?: () => void
}) {
  const root = items.find((i) => i.type === i.batch_root_type && i.id === i.batch_root_id) ?? items[0]
  const mode = items[0].batch_mode
  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center gap-3 border-b border-border bg-secondary/30 px-3 py-2.5">
        <TypeIcon type={root.type} size={16} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {root.title}
            <span className="ml-2 font-normal text-muted-foreground">
              + {items.length - 1} {items.length - 1 === 1 ? 'item' : 'items'}
              {mode === 'cascade' ? ' (deleted together)' : ''}
            </span>
          </p>
          <ItemMeta item={root} />
        </div>
        <RowActions onRestore={onRestore} onPurge={onPurge} restoreLabel="Restore group" />
      </div>
      <div className="divide-y divide-border">
        {items.map((it) => (
          <div key={keyOf(it)} className="group flex items-center gap-3 px-3 py-2 pl-6">
            <RowCheckbox
              checked={selected.has(keyOf(it))}
              onChange={() => onToggle(it)}
              anySelected={selected.size > 0}
            />
            <TypeIcon type={it.type} size={14} />
            <p className="min-w-0 flex-1 truncate text-[13px] text-foreground/80">{it.title}</p>
            <span className="text-xs capitalize text-muted-foreground">{it.type}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RowActions({
  onRestore,
  onPurge,
  restoreLabel = 'Restore',
}: {
  onRestore: () => void
  onPurge?: () => void
  restoreLabel?: string
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        onClick={onRestore}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <RotateCcw size={13} />
        {restoreLabel}
      </button>
      {onPurge ? (
        <button
          onClick={onPurge}
          title="Delete forever"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 size={14} />
        </button>
      ) : null}
    </div>
  )
}
