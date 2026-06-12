'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface PropertyOption {
  value: string
  label: string
  icon?: React.ReactNode
}

/**
 * Linear-style property picker: a quiet chip-button that opens a searchable
 * command list. Used in detail-page sidebars and create modals instead of
 * native <select>.
 */
export function PropertySelect({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Change…',
  buttonClassName,
  align = 'left',
  chevron = false,
  iconOnly = false,
  noSearch = false,
}: {
  value: string
  options: PropertyOption[]
  onChange: (v: string) => void
  placeholder?: string
  searchPlaceholder?: string
  buttonClassName?: string
  align?: 'left' | 'right'
  chevron?: boolean
  iconOnly?: boolean
  noSearch?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
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
      setHighlight(0)
      if (!noSearch) requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open, noSearch])

  const current = options.find((o) => o.value === value)
  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
  }, [options, query])

  function choose(v: string) {
    onChange(v)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          buttonClassName ??
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-secondary'
        }
      >
        {current?.icon ? <span className="shrink-0">{current.icon}</span> : null}
        {!iconOnly ? (
          <span className={`truncate ${current ? '' : 'text-muted-foreground'}`}>
            {current?.label ?? placeholder}
          </span>
        ) : null}
        {chevron ? <ChevronDown size={12} className="ml-auto shrink-0 text-muted-foreground" /> : null}
      </button>

      {open ? (
        <div
          className={`absolute top-full z-40 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-popover shadow-xl duration-100 animate-in fade-in zoom-in-95 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {!noSearch ? (
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setHighlight(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setHighlight((h) => Math.min(h + 1, filtered.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setHighlight((h) => Math.max(h - 1, 0))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  const opt = filtered[highlight]
                  if (opt) choose(opt.value)
                } else if (e.key === 'Escape') {
                  setOpen(false)
                }
              }}
              placeholder={searchPlaceholder}
              className="w-full border-b border-border bg-transparent px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground"
            />
          ) : null}
          <ul className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">No results</li>
            ) : (
              filtered.map((o, i) => (
                <li key={o.value || '∅'}>
                  <button
                    type="button"
                    onClick={() => choose(o.value)}
                    onMouseEnter={() => setHighlight(i)}
                    className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] ${
                      i === highlight ? 'bg-secondary' : ''
                    }`}
                  >
                    {o.icon ? <span className="shrink-0">{o.icon}</span> : null}
                    <span className="flex-1 truncate">{o.label}</span>
                    {o.value === value ? (
                      <Check size={13} className="shrink-0 text-muted-foreground" />
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
