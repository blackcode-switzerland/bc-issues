'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Search, Trash2, X } from 'lucide-react'

export interface BulkAction {
  key: string
  label: string
  icon?: React.ReactNode
  options: { value: string | number; label: string; icon?: React.ReactNode; color?: string }[]
  onSelect: (value: string | number) => void
  searchable?: boolean
}

interface BulkActionBarProps {
  count: number
  onClear: () => void
  actions: BulkAction[]
  onDelete?: () => void
  deleteLabel?: string
}

export function BulkActionBar({ count, onClear, actions, onDelete, deleteLabel }: BulkActionBarProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {count > 0 ? (
        <motion.div
          key="bulk-bar"
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.97 }}
          transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
        >
          <div className="flex max-w-[calc(100vw-2rem)] items-center gap-1 overflow-x-auto rounded-xl border border-border bg-popover px-2.5 py-2 shadow-2xl shadow-black/20">
            {/* Selection count */}
            <div className="flex items-center gap-2 rounded-lg bg-secondary/60 px-3.5 py-2 text-sm font-semibold">
              <span className="tabular-nums text-foreground">{count} selected</span>
              <button
                onClick={onClear}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X size={14} />
              </button>
            </div>

            <div className="mx-1 h-6 w-px bg-border" />

            {/* Action buttons */}
            {actions.map((action) => (
              <BulkActionMenu key={action.key} action={action} />
            ))}

            {/* Delete */}
            {onDelete ? (
              <>
                <div className="mx-1 h-6 w-px bg-border" />
                <button
                  onClick={onDelete}
                  className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                >
                  <Trash2 size={15} />
                  {deleteLabel ?? 'Delete'}
                </button>
              </>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  )
}

function BulkActionMenu({ action }: { action: BulkAction }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      if (action.searchable || action.options.length > 6) {
        requestAnimationFrame(() => inputRef.current?.focus())
      }
    }
  }, [open, action.searchable, action.options.length])

  const showSearch = action.searchable || action.options.length > 6
  const filtered = query
    ? action.options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : action.options

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        {action.icon}
        {action.label}
        <ChevronDown size={13} className="text-muted-foreground/60" />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full left-0 z-50 mb-2 w-52 overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
          >
            {showSearch ? (
              <div className="relative border-b border-border">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search…"
                  className="w-full bg-transparent py-2 pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground"
                />
              </div>
            ) : null}
            <ul className="max-h-60 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-2 text-xs text-muted-foreground">No results</li>
              ) : (
                filtered.map((opt) => (
                  <li key={String(opt.value)}>
                    <button
                      type="button"
                      onClick={() => {
                        action.onSelect(opt.value)
                        setOpen(false)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-foreground/80 transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      {opt.icon ? (
                        <span className="flex size-4 shrink-0 items-center justify-center">{opt.icon}</span>
                      ) : opt.color ? (
                        <span
                          className="inline-block size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: opt.color }}
                        />
                      ) : null}
                      <span className="flex-1 truncate">{opt.label}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

// Reusable row checkbox for list items
interface RowCheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  anySelected: boolean
  className?: string
}

export function RowCheckbox({ checked, onChange, anySelected, className = '' }: RowCheckboxProps) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center ${className}`}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
    >
      <div
        className={`flex size-3.5 items-center justify-center rounded border transition-all ${
          checked
            ? 'border-primary bg-primary'
            : anySelected
              ? 'border-border bg-background hover:border-primary/50'
              : 'border-transparent bg-transparent group-hover:border-border'
        }`}
      >
        {checked ? <Check size={9} strokeWidth={3} className="text-primary-foreground" /> : null}
      </div>
    </div>
  )
}
