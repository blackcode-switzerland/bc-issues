'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { Modal } from './modal'

/**
 * Shown before restoring items whose parent (project/task) is itself in
 * the bin or was purged. For each affected item the user picks:
 *   - restore_parent → bring the parent back too (re-links the item)
 *   - standalone     → restore the item with the link cleared
 * Defaults come from the server's batch-aware suggestion.
 */

export type RestoreResolution = 'restore_parent' | 'standalone'

export interface RestoreConflict {
  type: 'issue' | 'project' | 'task'
  id: number
  title: string
  parent_type: 'issue' | 'project' | 'task'
  parent_id: number
  parent_title: string | null
  kind: 'parent_binned' | 'parent_missing'
  suggested: RestoreResolution
}

interface Props {
  open: boolean
  conflicts: RestoreConflict[]
  busy?: boolean
  onCancel: () => void
  onConfirm: (resolutions: Record<string, RestoreResolution>) => void
}

export function RestoreConflictDialog({ open, conflicts, busy, onCancel, onConfirm }: Props) {
  // One row per item (an item may reference multiple binned parents; the choice
  // applies to all of them).
  const items = useMemo(() => {
    const byKey = new Map<string, RestoreConflict>()
    for (const c of conflicts) {
      const key = `${c.type}:${c.id}`
      if (!byKey.has(key)) byKey.set(key, c)
    }
    return Array.from(byKey.entries()).map(([key, c]) => ({ key, conflict: c }))
  }, [conflicts])

  const [choices, setChoices] = useState<Record<string, RestoreResolution>>({})

  useEffect(() => {
    if (!open) return
    const init: Record<string, RestoreResolution> = {}
    for (const { key, conflict } of items) init[key] = conflict.suggested
    setChoices(init)
  }, [open, items])

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Resolve restore conflicts"
      description="Some items belonged to things that are no longer active. Choose how to bring each one back."
      widthClass="max-w-lg"
    >
      <div className="space-y-4">
        <ul className="max-h-80 space-y-3 overflow-y-auto">
          {items.map(({ key, conflict }) => (
            <li key={key} className="rounded-lg border border-border p-3">
              <p className="text-sm font-medium text-foreground">{conflict.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {conflict.kind === 'parent_binned'
                  ? `Its ${conflict.parent_type} “${conflict.parent_title ?? 'unknown'}” is also in the Trash.`
                  : `Its ${conflict.parent_type} no longer exists.`}
              </p>
              <div className="mt-2 flex gap-2">
                {conflict.kind === 'parent_binned' ? (
                  <Choice
                    active={choices[key] === 'restore_parent'}
                    onClick={() => setChoices((c) => ({ ...c, [key]: 'restore_parent' }))}
                    label={`Restore the ${conflict.parent_type} too`}
                  />
                ) : null}
                <Choice
                  active={choices[key] === 'standalone'}
                  onClick={() => setChoices((c) => ({ ...c, [key]: 'standalone' }))}
                  label="Restore standalone"
                />
              </div>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm(choices)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            Restore
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Choice({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border text-muted-foreground hover:bg-secondary'
      }`}
    >
      {label}
    </button>
  )
}
