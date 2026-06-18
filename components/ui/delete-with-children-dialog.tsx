'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { Modal } from './modal'

/**
 * Delete dialog for projects and tasks — where the user must choose what
 * happens to the attached issues/tasks. `useConfirm` can only return a
 * boolean, so this is a separate imperative dialog that returns the chosen
 * delete *mode*:
 *
 *   const { confirmDelete } = useDeleteDialog()
 *   const decision = await confirmDelete({ kind: 'project', name, previewUrl })
 *   if (!decision) return            // cancelled
 *   await fetch(`${url}?mode=${decision.mode}`, { method: 'DELETE' })
 *
 *   - mode 'detach'  → only the parent goes to Trash; children stay active,
 *                      unlinked (the previous default behavior).
 *   - mode 'cascade' → the parent AND its children go to Trash together and
 *                      restore as a group.
 */

export type DeleteMode = 'cascade' | 'detach'

export interface DeleteDialogOptions {
  kind: 'project' | 'task'
  /** Name of the item, shown in the title. */
  name?: string
  /** Precomputed child counts (used for bulk where we don't fetch per item). */
  counts?: { issues: number; tasks: number }
  /** If set, the dialog fetches exact counts from this `?preview=1` URL. */
  previewUrl?: string
  /** Override the count copy entirely (e.g. "12 issues across 3 projects"). */
  childLabel?: string
  confirmLabel?: string
}

export interface DeleteDecision {
  mode: DeleteMode
}

interface Pending {
  opts: DeleteDialogOptions
  resolve: (v: DeleteDecision | null) => void
}

interface DeleteDialogContextValue {
  confirmDelete: (opts: DeleteDialogOptions) => Promise<DeleteDecision | null>
}

const Ctx = createContext<DeleteDialogContextValue | null>(null)

export function useDeleteDialog(): DeleteDialogContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDeleteDialog must be used within <DeleteDialogProvider>')
  return ctx
}

function childSummary(
  kind: 'project' | 'task',
  counts: { issues: number; tasks: number } | null,
  childLabel?: string
): string {
  if (childLabel) return childLabel
  if (!counts) return kind === 'project' ? 'its issues and tasks' : 'its issues'
  const parts: string[] = []
  if (counts.issues > 0) parts.push(`${counts.issues} ${counts.issues === 1 ? 'issue' : 'issues'}`)
  if (kind === 'project' && counts.tasks > 0) {
    parts.push(`${counts.tasks} ${counts.tasks === 1 ? 'task' : 'tasks'}`)
  }
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${parts[0]} and ${parts[1]}`
}

export function DeleteDialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [mode, setMode] = useState<DeleteMode>('detach')
  const [counts, setCounts] = useState<{ issues: number; tasks: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const resolverRef = useRef<Pending | null>(null)

  const confirmDelete = useCallback(
    (opts: DeleteDialogOptions) =>
      new Promise<DeleteDecision | null>((resolve) => {
        const p: Pending = { opts, resolve }
        resolverRef.current = p
        setMode('detach')
        setCounts(opts.counts ?? null)
        setPending(p)
      }),
    []
  )

  // Fetch exact child counts when a previewUrl is provided.
  useEffect(() => {
    const url = pending?.opts.previewUrl
    if (!url) return
    let cancelled = false
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j && typeof j === 'object') {
          setCounts({ issues: Number(j.issues ?? 0), tasks: Number(j.tasks ?? 0) })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [pending])

  const settle = useCallback((result: DeleteDecision | null) => {
    const p = resolverRef.current
    if (!p) return
    p.resolve(result)
    resolverRef.current = null
    setPending(null)
    setBusy(false)
  }, [])

  const opts = pending?.opts
  const summary = childSummary(opts?.kind ?? 'project', counts, opts?.childLabel)
  const hasChildren = !counts || counts.issues > 0 || (opts?.kind === 'project' && counts.tasks > 0)
  const noun = opts?.kind ?? 'project'

  return (
    <Ctx.Provider value={{ confirmDelete }}>
      {children}
      <Modal
        open={!!pending}
        onClose={() => settle(null)}
        title={opts ? `Delete ${noun}${opts.name ? ` “${opts.name}”` : ''}?` : undefined}
        description="It will be moved to Trash. You can restore it later."
        widthClass="max-w-md"
      >
        {opts ? (
          <div className="space-y-4">
            {hasChildren ? (
              <div className="space-y-2">
                <ModeOption
                  selected={mode === 'detach'}
                  onSelect={() => setMode('detach')}
                  title={`Keep ${summary || 'the contents'}`}
                  body={`Only the ${noun} goes to Trash. ${
                    summary ? capitalize(summary) : 'The contents'
                  } stay active, detached from it.`}
                />
                <ModeOption
                  selected={mode === 'cascade'}
                  onSelect={() => setMode('cascade')}
                  title={`Move ${summary || 'everything'} to Trash too`}
                  body={`The ${noun} and ${
                    summary || 'its contents'
                  } go to Trash together and restore as a group.`}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                This {noun} has no attached items.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => settle(null)}
                className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setBusy(true)
                  settle({ mode })
                }}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {opts.confirmLabel ?? 'Move to Trash'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </Ctx.Provider>
  )
}

function ModeOption({
  selected,
  onSelect,
  title,
  body,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  body: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
        selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary/50'
      }`}
    >
      <span
        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
          selected ? 'border-primary' : 'border-muted-foreground/40'
        }`}
      >
        {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{body}</span>
      </span>
    </button>
  )
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
