'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Filter, Search, X } from 'lucide-react'

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
}

export function MultiSelect({ label, options, selected, onChange }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function toggle(v: string | number) {
    if (selected.includes(v)) {
      onChange(selected.filter((s) => s !== v))
    } else {
      onChange([...selected, v])
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
          selected.length > 0
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-border text-muted-foreground hover:bg-secondary'
        }`}
      >
        {label}
        {selected.length > 0 ? (
          <span className="rounded-full bg-primary/20 px-1.5 text-[10px]">{selected.length}</span>
        ) : null}
        <ChevronDown size={12} />
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
          <ul className="max-h-64 overflow-y-auto py-1">
            {options.map((opt) => {
              const isSelected = selected.includes(opt.value)
              return (
                <li key={String(opt.value)}>
                  <button
                    type="button"
                    onClick={() => toggle(opt.value)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-secondary"
                  >
                    {opt.icon ? (
                      <span className="flex size-3.5 shrink-0 items-center justify-center">
                        {opt.icon}
                      </span>
                    ) : opt.color ? (
                      <span
                        className="inline-block size-2.5 rounded-full"
                        style={{ backgroundColor: opt.color }}
                      />
                    ) : null}
                    <span className="flex-1 truncate">{opt.label}</span>
                    {isSelected ? <Check size={12} className="text-primary" /> : null}
                  </button>
                </li>
              )
            })}
          </ul>
          {selected.length > 0 ? (
            <div className="border-t border-border">
              <button
                onClick={() => onChange([])}
                className="w-full px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-secondary"
              >
                Clear
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
    <div className="relative flex-1">
      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-background pl-7 pr-7 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
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

export function ViewToggle({ value, onChange, available = ['list', 'kanban', 'timeline'] }: ViewToggleProps) {
  return (
    <div className="inline-flex rounded-md border border-border bg-secondary/50 p-0.5">
      {available.map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`rounded px-2.5 py-1 text-xs capitalize transition-colors ${
            value === m
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {m}
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
    <div className="flex flex-wrap items-center gap-2">
      <Filter size={14} className="text-muted-foreground" />
      {children}
    </div>
  )
}
