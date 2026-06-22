'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Tag, Trash2 } from 'lucide-react'
import {
  EmptyState,
  LabelSkeletonRow,
  AnimatePresence,
  motion,
  listContainerVariants,
  listItemVariants,
} from '@/components/ui/motion'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { BulkActionBar, RowCheckbox, type BulkAction } from './listings/bulk-action-bar'
import { PRESET_COLORS, COLOR_NAMES } from './label-colors'

interface LabelRow {
  id: number
  name: string
  color: string
  description: string | null
  issue_count: number
  created_at: string
}

export function LabelsView() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const { data: ws } = useActiveWorkspace()
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

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

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/labels/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      toast.success('Label deleted')
      queryClient.invalidateQueries({ queryKey: ['ws-labels-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-labels'] })
      queryClient.invalidateQueries({ queryKey: ['issue-labels'] })
      queryClient.invalidateQueries({ queryKey: ['ws-issues'] })
      queryClient.invalidateQueries({ queryKey: ['project-issues'] })
      queryClient.invalidateQueries({ queryKey: ['task-issues'] })
      queryClient.invalidateQueries({ queryKey: ['sidebar-counts'] })
    },
    onError: () => toast.error('Could not delete label'),
  })

  async function bulkDelete() {
    const ids = Array.from(selectedIds)
    const ok = await confirm({
      title: `Delete ${ids.length} ${ids.length === 1 ? 'label' : 'labels'}?`,
      description:
        'The selected labels will be removed from all issues. This cannot be undone.',
      destructive: true,
      confirmLabel: `Delete ${ids.length} ${ids.length === 1 ? 'label' : 'labels'}`,
    })
    if (!ok) return
    try {
      await Promise.all(
        ids.map((id) => fetch(`/api/workspaces/${ws!.slug}/labels/${id}`, { method: 'DELETE' }))
      )
      toast.success(`Deleted ${ids.length} ${ids.length === 1 ? 'label' : 'labels'}`)
      setSelectedIds(new Set())
      queryClient.invalidateQueries({ queryKey: ['ws-labels-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-labels'] })
      queryClient.invalidateQueries({ queryKey: ['issue-labels'] })
      queryClient.invalidateQueries({ queryKey: ['ws-issues'] })
      queryClient.invalidateQueries({ queryKey: ['project-issues'] })
      queryClient.invalidateQueries({ queryKey: ['task-issues'] })
      queryClient.invalidateQueries({ queryKey: ['sidebar-counts'] })
    } catch {
      toast.error('Some labels could not be deleted')
    }
  }

  async function bulkRecolor(color: string) {
    const ids = Array.from(selectedIds)
    const colorName = COLOR_NAMES[color] ?? color
    const ok = await confirm({
      title: `Change color for ${ids.length} ${ids.length === 1 ? 'label' : 'labels'}?`,
      description: `All selected labels will be updated to ${colorName}.`,
      confirmLabel: 'Apply',
    })
    if (!ok) return
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/workspaces/${ws!.slug}/labels/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ color }),
          })
        )
      )
      toast.success(`Updated color on ${ids.length} ${ids.length === 1 ? 'label' : 'labels'}`)
      queryClient.invalidateQueries({ queryKey: ['ws-labels-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-labels'] })
      queryClient.invalidateQueries({ queryKey: ['issue-labels'] })
      queryClient.invalidateQueries({ queryKey: ['ws-issues'] })
      queryClient.invalidateQueries({ queryKey: ['project-issues'] })
      queryClient.invalidateQueries({ queryKey: ['task-issues'] })
    } catch {
      toast.error('Some labels could not be updated')
    }
  }

  const anySelected = selectedIds.size > 0

  const bulkActions: BulkAction[] = [
    {
      key: 'color',
      label: 'Color',
      options: PRESET_COLORS.map((c) => ({
        value: c,
        label: COLOR_NAMES[c] ?? c,
        color: c,
      })),
      onSelect: (v) => bulkRecolor(String(v)),
    },
  ]

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2.5 border-b border-border bg-background/80 px-4 backdrop-blur">
        <span className="text-[15px] font-semibold">Labels</span>
        <span className="flex items-center justify-center rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium tabular-nums text-foreground/70 ring-1 ring-border/60">
          {labels.data?.length ?? 0}
        </span>
        <Link
          href={`/dashboard/${ws?.slug}/labels/new`}
          className="ml-auto flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus size={15} />
          New label
        </Link>
      </header>

      {labels.isLoading ? (
        <div>
          {Array.from({ length: 6 }).map((_, i) => (
            <LabelSkeletonRow key={i} i={i} />
          ))}
        </div>
      ) : !labels.data?.length ? (
        <EmptyState
          icon={<Tag size={28} />}
          title="No labels yet"
          description="Create labels to categorize and filter your issues."
          action={{ label: <><Plus size={14} />New label</>, onClick: () => router.push(`/dashboard/${ws?.slug}/labels/new`) }}
        />
      ) : (
        <motion.ul variants={listContainerVariants} initial="hidden" animate="show">
          <AnimatePresence initial={false}>
          {labels.data.map((l) => (
              <motion.li
                key={l.id}
                variants={listItemVariants}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                layout
                className={`group flex cursor-pointer items-center gap-3 border-b border-border/50 px-6 py-2.5 transition-colors hover:bg-secondary/40 ${selectedIds.has(l.id) ? 'bg-primary/5' : ''}`}
                onClick={() => {
                  if (anySelected) {
                    const next = new Set(selectedIds)
                    if (selectedIds.has(l.id)) next.delete(l.id)
                    else next.add(l.id)
                    setSelectedIds(next)
                    return
                  }
                  router.push(`/dashboard/${ws?.slug}/labels/${l.id}`)
                }}
              >
                {/* Checkbox */}
                <RowCheckbox
                  checked={selectedIds.has(l.id)}
                  onChange={(checked) => {
                    const next = new Set(selectedIds)
                    if (checked) next.add(l.id)
                    else next.delete(l.id)
                    setSelectedIds(next)
                  }}
                  anySelected={anySelected}
                  className="size-4 shrink-0"
                />

                <span className="size-3.5 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
                <span className="shrink-0 text-sm font-medium">{l.name}</span>
                <div className="min-w-0 flex-1">
                  {l.description ? (
                    <p className="truncate text-xs text-muted-foreground">{l.description}</p>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {l.issue_count} {l.issue_count === 1 ? 'issue' : 'issues'}
                </span>
                <div
                  className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
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
              </motion.li>
            )
          )}
          </AnimatePresence>
        </motion.ul>
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
