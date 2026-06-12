'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Filter, List, LayoutGrid, GanttChart, Search, X } from 'lucide-react'

export interface MultiSelectOption {
  value: string | number
  label: string
  color?: string
  icon?: React.ReactNode
}

interface MultiSelectProps {
  label: string
  options: MultiSelectOption[]
  selected: Array<string | number>
  onChange: (v: Array<string | number>) => void
  searchable?: boolean
}

export function MultiSelect({ label, options, selected, onChange, searchable }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      if (searchable) requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open, searchable])

  function toggle(v: string | number) {
    if (selected.includes(v)) {
      onChange(selected.filter((s) => s !== v))
    } else {
      onChange([...selected, v])
    }
  }

  const autoSearch = options.length > 6
  const showSearch = searchable || autoSearch

  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
          selected.length > 0
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground'
        }`}
      >
        {label}
        {selected.length > 0 ? (
          <span className="rounded-full bg-primary/20 px-1.5 text-[10px] font-semibold">{selected.length}</span>
        ) : null}
        <ChevronDown size={11} />
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
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
              filtered.map((opt) => {
                const isSelected = selected.includes(opt.value)
                return (
                  <li key={String(opt.value)}>
                    <button
                      type="button"
                      onClick={() => toggle(opt.value)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-secondary ${isSelected ? 'text-foreground' : 'text-foreground/80'}`}
                    >
                      {opt.icon ? (
                        <span className="flex size-4 shrink-0 items-center justify-center">
                          {opt.icon}
                        </span>
                      ) : opt.color ? (
                        <span
                          className="inline-block size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: opt.color }}
                        />
                      ) : null}
                      <span className="flex-1 truncate">{opt.label}</span>
                      {isSelected ? <Check size={12} className="shrink-0 text-primary" /> : null}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
          {selected.length > 0 ? (
            <div className="border-t border-border">
              <button
                onClick={() => onChange([])}
                className="w-full px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-secondary"
              >
                Clear filter
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

interface SearchInputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

export function SearchInput({ value, onChange, placeholder = 'Search…' }: SearchInputProps) {
  return (
    <div className="relative w-52 shrink-0">
      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-md border border-border bg-secondary/30 pl-8 pr-7 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-ring/50 focus:bg-background focus:ring-0"
      />
      {value ? (
        <button
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-secondary"
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  )
}

export type ViewMode = 'list' | 'kanban' | 'timeline'

interface ViewToggleProps {
  value: ViewMode
  onChange: (v: ViewMode) => void
  available?: ViewMode[]
}

const VIEW_ICONS: Record<ViewMode, React.ReactNode> = {
  list: <List size={14} />,
  kanban: <LayoutGrid size={14} />,
  timeline: <GanttChart size={14} />,
}

export function ViewToggle({ value, onChange, available = ['list', 'kanban', 'timeline'] }: ViewToggleProps) {
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-secondary/50 p-0.5">
      {available.map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          title={m.charAt(0).toUpperCase() + m.slice(1)}
          className={`flex items-center justify-center rounded px-2 py-1 transition-colors ${
            value === m
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {VIEW_ICONS[m]}
        </button>
      ))}
    </div>
  )
}

interface FilterBarProps {
  children: React.ReactNode
}

export function FilterBar({ children }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Filter size={13} className="shrink-0 text-muted-foreground/60" />
      {children}
    </div>
  )
}
